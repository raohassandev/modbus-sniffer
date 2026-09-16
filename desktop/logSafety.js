'use strict';

function redactLogSecrets(message) {
  let text = String(message || '');
  text = text.replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]');
  text = text.replace(/("(?:password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|key[_-]?path)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"');
  text = text.replace(/\b(password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|key[_-]?path)\s*=\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  return text;
}

module.exports = { redactLogSecrets };
