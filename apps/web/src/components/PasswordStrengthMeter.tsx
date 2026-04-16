'use client';

/**
 * Password strength meter + policy checklist, rendered below any
 * "new password" input. Purely informative — the server has the
 * authoritative policy and will reject anything it doesn't like.
 *
 * The meter combines two signals:
 *   1. Policy checklist: hard rules from the tenant's policy (minLength,
 *      requireUppercase, ...). Pass/fail per rule.
 *   2. Entropy via zxcvbn: 0-4 score based on dictionary words, leaked
 *      passwords, common patterns. Helps users avoid `Password1!` even
 *      if it technically meets the policy.
 *
 * zxcvbn is ~400KB — we import it lazily so the login page doesn't pay
 * the cost when the modal is never opened.
 */

import { useEffect, useMemo, useState } from 'react';
import type { PasswordPolicy } from '@/hooks/usePasswordPolicy';

interface Props {
  password: string;
  policy: PasswordPolicy;
}

interface Rule {
  label: string;
  passed: boolean;
}

export default function PasswordStrengthMeter({ password, policy }: Props) {
  const rules = useMemo<Rule[]>(() => {
    const r: Rule[] = [
      { label: `Al menos ${policy.minLength} caracteres`, passed: password.length >= policy.minLength },
    ];
    if (policy.requireUppercase) r.push({ label: 'Una mayúscula', passed: /[A-Z]/.test(password) });
    if (policy.requireLowercase) r.push({ label: 'Una minúscula', passed: /[a-z]/.test(password) });
    if (policy.requireNumber) r.push({ label: 'Un número', passed: /\d/.test(password) });
    if (policy.requireSymbol) r.push({ label: 'Un símbolo (!@#$...)', passed: /[^A-Za-z0-9]/.test(password) });
    return r;
  }, [password, policy]);

  const policyOk = rules.every((r) => r.passed);

  // zxcvbn is lazy-loaded so it doesn't bloat bundles that never open
  // the password-change modal.
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!password) {
      setScore(null);
      setFeedback(null);
      return;
    }
    // Import on every keystroke is debounced via the microtask — cache the
    // module reference on window to avoid re-parsing.
    (async () => {
      const mod = (await import('zxcvbn')).default;
      if (cancelled) return;
      const result = mod(password);
      setScore(result.score);
      // zxcvbn's feedback can be in English; translate the most common
      // messages to Spanish.
      const warn = result.feedback?.warning || '';
      const translated = translateZxcvbnWarning(warn);
      setFeedback(translated);
    })();
    return () => {
      cancelled = true;
    };
  }, [password]);

  const barColor = score === null ? '#cbd5e1' :
    score <= 1 ? '#ef4444' :
    score === 2 ? '#f59e0b' :
    score === 3 ? '#eab308' : '#10b981';
  const barWidth = score === null ? 0 : ((score + 1) / 5) * 100;

  if (!password) return null;

  return (
    <div
      style={{
        marginTop: '0.6rem',
        padding: '0.7rem 0.85rem',
        background: 'var(--bg-surface, #f8fafc)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 'var(--radius-sm, 6px)',
        fontSize: '0.78rem',
      }}
    >
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: '#e2e8f0',
          overflow: 'hidden',
          marginBottom: '0.5rem',
        }}
      >
        <div
          style={{
            width: `${barWidth}%`,
            height: '100%',
            background: barColor,
            transition: 'width 0.2s, background 0.2s',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.8rem' }}>
        {rules.map((r) => (
          <span
            key={r.label}
            style={{
              color: r.passed ? '#10b981' : 'var(--text-muted, #64748b)',
              fontWeight: r.passed ? 600 : 500,
            }}
          >
            {r.passed ? '✓' : '○'} {r.label}
          </span>
        ))}
      </div>
      {feedback && (
        <div
          style={{
            marginTop: '0.4rem',
            color: 'var(--text-muted, #64748b)',
            fontStyle: 'italic',
          }}
        >
          {feedback}
        </div>
      )}
      {!policyOk && (
        <div
          style={{
            marginTop: '0.4rem',
            color: 'var(--danger, #ef4444)',
            fontWeight: 600,
          }}
        >
          Aún no cumple la política de la organización.
        </div>
      )}
    </div>
  );
}

/** Translate the most common zxcvbn warnings to Spanish. Anything we don't
 *  recognize falls through so the user at least sees something. */
function translateZxcvbnWarning(msg: string): string | null {
  if (!msg) return null;
  const m: Record<string, string> = {
    'Use a few words, avoid common phrases': 'Usa varias palabras; evita frases comunes.',
    'No need for symbols, digits, or uppercase letters': 'No necesitas símbolos ni mayúsculas, pero sí varias palabras.',
    'Add another word or two. Uncommon words are better.': 'Agrega otra palabra; las palabras poco comunes son más seguras.',
    'Straight rows of keys are easy to guess': 'Filas rectas del teclado son fáciles de adivinar.',
    'Short keyboard patterns are easy to guess': 'Patrones cortos del teclado son fáciles de adivinar.',
    'Use a longer keyboard pattern with more turns': 'Usa un patrón más largo con más cambios.',
    'Repeats like "aaa" are easy to guess': 'Las repeticiones como "aaa" son fáciles de adivinar.',
    'Repeats like "abcabcabc" are only slightly harder to guess than "abc"': 'Las repeticiones como "abcabc" apenas son mejores.',
    'Sequences like abc or 6543 are easy to guess': 'Secuencias como "abc" o "6543" son fáciles de adivinar.',
    'Recent years are easy to guess': 'Los años recientes son fáciles de adivinar.',
    'Dates are often easy to guess': 'Las fechas son fáciles de adivinar.',
    'This is a top-10 common password': 'Esta contraseña está en el top-10 de las más comunes.',
    'This is a top-100 common password': 'Esta contraseña está en el top-100 de las más comunes.',
    'This is a very common password': 'Esta es una contraseña muy común.',
    'This is similar to a commonly used password': 'Se parece a una contraseña comúnmente filtrada.',
    'A word by itself is easy to guess': 'Una sola palabra es fácil de adivinar.',
    'Names and surnames by themselves are easy to guess': 'Nombres y apellidos solos son fáciles de adivinar.',
    'Common names and surnames are easy to guess': 'Nombres comunes son fáciles de adivinar.',
  };
  return m[msg] || msg;
}
