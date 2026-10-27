import { translationParts } from '../../shared/browser-language.js';
import { translationSource } from '../../shared/translation-cache-identity.js';
import { ProviderRequestError, validateParsedTranslation } from './shared.js';

// Recover an explicitly structured segment without asking a model to generate
// markup or protected code. This bounded fallback trades sentence-level context
// for intact source structure; normal valid translations never enter it.
export function structuredRecoveryPlan(segment) {
  const source = translationSource(segment);
  if (source.format !== 'tf-markers') throw malformed();
  const parts = [], fragments = [];
  function append(text, protectedPart) {
    if (!text || protectedPart || !/\p{L}/u.test(text)) { parts.push(text); return; }
    if (fragments.length >= 128) throw malformed();
    const id = `${segment.id}:part:${fragments.length}`;
    const leading = text.match(/^\s*/u)[0], trailing = text.match(/\s*$/u)[0];
    fragments.push({ id, text: text.trim(), format: 'plain', protectedIds: [] });
    parts.push({ id, leading, trailing });
  }
  try {
    for (const part of translationParts(source.text, source.protectedIds)) append(part.text, part.protected);
  } catch { throw malformed(); }
  return { fragments, restore(translations) {
    validateParsedTranslation(translations, fragments);
    const values = new Map(translations.map(item => [String(item.id), item.text.trim()]));
    const text = parts.map(part => typeof part === 'string' ? part : part.leading + values.get(part.id) + part.trailing).join('');
    return validateParsedTranslation([{ id: String(segment.id), text }], [segment])[0];
  } };
}
function malformed() { return new ProviderRequestError('无法安全恢复译文格式，请缩小选区后重试。', { code: 'MALFORMED_RESPONSE' }); }
