export interface DecisionQuestionPresentation {
  summary: string;
  suggestion: string | null;
  original: string;
  showOriginal: boolean;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function presentDecisionQuestion(question: string): DecisionQuestionPresentation {
  const original = question.trim();
  const withoutBullet = original.replace(/^[-*]\s+/, '').trim();
  if (withoutBullet.startsWith('{') && withoutBullet.endsWith('}')) {
    try {
      const parsed = JSON.parse(withoutBullet) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const summary = nonEmptyString(record.issue) ?? nonEmptyString(record.fallback);
        if (summary !== null) {
          return {
            summary,
            suggestion: nonEmptyString(record.suggestion),
            original,
            showOriginal: true,
          };
        }
      }
    } catch {
      // The exact source text remains visible when it is not a valid JSON record.
    }
  }

  const summary = withoutBullet
    .replace(/\[Manual Review Required\]/gi, '')
    .replace(/^[-*\s:]+/, '')
    .trim();
  const friendlySummary = summary || 'Cần người dùng xác nhận trước khi tiếp tục.';
  return {
    summary: friendlySummary,
    suggestion: null,
    original,
    showOriginal: friendlySummary !== original,
  };
}
