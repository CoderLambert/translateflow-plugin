//go:build linux

package siwc

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"time"

	dbus "github.com/godbus/dbus/v5"
)

const (
	secretServiceName      = "org.freedesktop.secrets"
	secretServicePath      = dbus.ObjectPath("/org/freedesktop/secrets")
	secretServiceInterface = "org.freedesktop.Secret.Service"
	secretCollectionIface  = "org.freedesktop.Secret.Collection"
	secretItemInterface    = "org.freedesktop.Secret.Item"
	secretPropertiesIface  = "org.freedesktop.DBus.Properties"
	secretCallTimeout      = 5 * time.Second
	linuxCredentialService = "CoderLambert.TranslateFlow.NativeHost"
	linuxCredentialUser    = "credentials-v1"
)

type linuxSecretServiceBlob struct{}

type secretValue struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string `dbus:"content_type"`
}

func newSystemSecureBlobStore(string) (SecureBlobStore, error) {
	return linuxSecretServiceBlob{}, nil
}

func (linuxSecretServiceBlob) Read(parent context.Context) ([]byte, error) {
	var value []byte
	err := withSecretService(parent, func(ctx context.Context, conn *dbus.Conn) error {
		collection, err := defaultSecretCollection(ctx, conn)
		if err != nil {
			return err
		}
		locked, err := secretObjectLocked(ctx, conn, collection, secretCollectionIface)
		if err != nil {
			return err
		}
		if locked {
			return ErrSecureStoreLocked
		}
		item, err := findSecretItem(ctx, conn, collection)
		if err != nil {
			return err
		}
		locked, err = secretObjectLocked(ctx, conn, item, secretItemInterface)
		if err != nil {
			return err
		}
		if locked {
			return ErrSecureStoreLocked
		}
		session, err := openSecretSession(ctx, conn)
		if err != nil {
			return err
		}
		var secret secretValue
		if err := callSecretService(ctx, conn.Object(secretServiceName, item), secretItemInterface+".GetSecret", []any{session}, &secret); err != nil {
			return err
		}
		value = append([]byte(nil), secret.Value...)
		return nil
	})
	if err != nil {
		return nil, normalizeSecretServiceError(parent, err)
	}
	return value, nil
}

func (linuxSecretServiceBlob) Write(parent context.Context, value []byte) error {
	err := withSecretService(parent, func(ctx context.Context, conn *dbus.Conn) error {
		collection, err := defaultSecretCollection(ctx, conn)
		if err != nil {
			return err
		}
		locked, err := secretObjectLocked(ctx, conn, collection, secretCollectionIface)
		if err != nil {
			return err
		}
		if locked {
			return ErrSecureStoreLocked
		}
		items, err := searchSecretItems(ctx, conn, collection)
		if err != nil && !errors.Is(err, ErrSecureBlobNotFound) {
			return err
		}
		for _, item := range items {
			itemLocked, err := secretObjectLocked(ctx, conn, item, secretItemInterface)
			if err != nil {
				return err
			}
			if itemLocked {
				return ErrSecureStoreLocked
			}
		}
		session, err := openSecretSession(ctx, conn)
		if err != nil {
			return err
		}
		attributes := map[string]string{
			"username": linuxCredentialUser,
			"service":  linuxCredentialService,
		}
		properties := map[string]dbus.Variant{
			secretItemInterface + ".Label":      dbus.MakeVariant("TranslateFlow native host credentials"),
			secretItemInterface + ".Attributes": dbus.MakeVariant(attributes),
		}
		secret := secretValue{
			Session:     session,
			Parameters:  []byte{},
			Value:       append([]byte(nil), value...),
			ContentType: "application/json",
		}
		var itemPath, promptPath dbus.ObjectPath
		if err := callSecretService(ctx, conn.Object(secretServiceName, collection), secretCollectionIface+".CreateItem", []any{properties, secret, true}, &itemPath, &promptPath); err != nil {
			return err
		}
		// Never invoke Prompt: a returned prompt means the login collection is
		// locked or requires user interaction. No deferred write is left running.
		if itemPath == "/" || promptPath != "/" {
			return ErrSecureStoreLocked
		}
		return nil
	})
	if err != nil {
		return normalizeSecretServiceError(parent, err)
	}
	return nil
}

func withSecretService(parent context.Context, operation func(context.Context, *dbus.Conn) error) error {
	ctx, cancel := context.WithTimeout(parent, secretCallTimeout)
	defer cancel()
	address, err := sessionBusSocketAddress(os.Getenv("DBUS_SESSION_BUS_ADDRESS"))
	if err != nil {
		return err
	}
	dialer := net.Dialer{Timeout: secretCallTimeout}
	transport, err := dialer.DialContext(ctx, "unix", address)
	if err != nil {
		return err
	}
	unixConn, ok := transport.(*net.UnixConn)
	if !ok {
		_ = transport.Close()
		return ErrSecureStoreUnavailable
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := unixConn.SetDeadline(deadline); err != nil {
			_ = unixConn.Close()
			return err
		}
	}
	conn, err := dbus.DialUnix(unixConn, dbus.WithContext(ctx))
	if err != nil {
		cancel()
		_ = unixConn.Close()
		return err
	}
	defer conn.Close()
	// Auth and Hello do not expose context-taking methods in godbus. The
	// transport deadline bounds both, and the connection context closes the
	// socket immediately if its parent is cancelled.
	if err := conn.Auth(nil); err != nil {
		return err
	}
	if err := conn.Hello(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return operation(ctx, conn)
}

func sessionBusSocketAddress(raw string) (string, error) {
	for _, candidate := range strings.Split(raw, ";") {
		transport, fields, ok := strings.Cut(candidate, ":")
		if !ok || transport != "unix" {
			continue
		}
		var path, abstract string
		valid := true
		for _, field := range strings.Split(fields, ",") {
			key, rawValue, ok := strings.Cut(field, "=")
			if !ok {
				valid = false
				break
			}
			value, err := dbus.UnescapeBusAddressValue(rawValue)
			if err != nil {
				valid = false
				break
			}
			switch key {
			case "path":
				path = value
			case "abstract":
				abstract = value
			}
		}
		if !valid || (path == "") == (abstract == "") {
			continue
		}
		if path != "" {
			return path, nil
		}
		return "@" + abstract, nil
	}
	return "", ErrSecureStoreUnavailable
}

func defaultSecretCollection(ctx context.Context, conn *dbus.Conn) (dbus.ObjectPath, error) {
	var collection dbus.ObjectPath
	service := conn.Object(secretServiceName, secretServicePath)
	if err := callSecretService(ctx, service, secretServiceInterface+".ReadAlias", []any{"default"}, &collection); err != nil {
		return "", err
	}
	if !collection.IsValid() || collection == "/" {
		return "", ErrSecureBlobNotFound
	}
	return collection, nil
}

func findSecretItem(ctx context.Context, conn *dbus.Conn, collection dbus.ObjectPath) (dbus.ObjectPath, error) {
	items, err := searchSecretItems(ctx, conn, collection)
	if err != nil {
		return "", err
	}
	return items[0], nil
}

func searchSecretItems(ctx context.Context, conn *dbus.Conn, collection dbus.ObjectPath) ([]dbus.ObjectPath, error) {
	attributes := map[string]string{
		"username": linuxCredentialUser,
		"service":  linuxCredentialService,
	}
	var items []dbus.ObjectPath
	if err := callSecretService(ctx, conn.Object(secretServiceName, collection), secretCollectionIface+".SearchItems", []any{attributes}, &items); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ErrSecureBlobNotFound
	}
	return items, nil
}

func secretObjectLocked(ctx context.Context, conn *dbus.Conn, path dbus.ObjectPath, iface string) (bool, error) {
	var property dbus.Variant
	if err := callSecretService(ctx, conn.Object(secretServiceName, path), secretPropertiesIface+".Get", []any{iface, "Locked"}, &property); err != nil {
		return false, err
	}
	locked, ok := property.Value().(bool)
	if !ok {
		return false, ErrSecureStoreUnavailable
	}
	return locked, nil
}

func openSecretSession(ctx context.Context, conn *dbus.Conn) (dbus.ObjectPath, error) {
	var algorithm dbus.Variant
	var session dbus.ObjectPath
	service := conn.Object(secretServiceName, secretServicePath)
	if err := callSecretService(ctx, service, secretServiceInterface+".OpenSession", []any{"plain", dbus.MakeVariant("")}, &algorithm, &session); err != nil {
		return "", err
	}
	if !session.IsValid() || session == "/" {
		return "", ErrSecureStoreUnavailable
	}
	return session, nil
}

func callSecretService(ctx context.Context, object dbus.BusObject, method string, args []any, outputs ...any) error {
	call := object.CallWithContext(ctx, method, 0, args...)
	if err := call.Store(outputs...); err != nil {
		return err
	}
	return nil
}

func normalizeSecretServiceError(parent context.Context, err error) error {
	if parent.Err() != nil {
		return parent.Err()
	}
	if errors.Is(err, ErrSecureBlobNotFound) || errors.Is(err, ErrSecureStoreLocked) {
		return err
	}
	var busErr dbus.Error
	if errors.As(err, &busErr) && strings.HasSuffix(busErr.Name, ".IsLocked") {
		return ErrSecureStoreLocked
	}
	return ErrSecureStoreUnavailable
}
