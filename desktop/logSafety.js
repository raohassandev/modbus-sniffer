'use strict';

function redactLogSecrets(message) {
  let text = String(message || '');
  text = text.replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]');
  text = text.replace(/("(?:password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie|set[_-]?cookie|credential|credentials|private[_-]?key|key[_-]?path|client[_-]?key|server[_-]?key|pfx|pkcs12)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"');
  text = text.replace(/\b(password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|credential|credentials|private[_-]?key|key[_-]?path|client[_-]?key|server[_-]?key|pfx|pkcs12)\s*=\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  text = text.replace(/\bauthorization\s*:\s*[^\r\n,]+/gi, 'Authorization: [REDACTED]');
  text = text.replace(/\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]');
  return text;
}

module.exports = { redactLogSecrets };
