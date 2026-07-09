/** Structured sections parsed from a workflow description. */
export interface ParsedDescription {
  whenToUse: string;
  triggers: string[];
  does: string;
  constraints: string;
  raw: string;
}

export function parseWorkflowDescription(description: string): ParsedDescription {
  const result: ParsedDescription = {
    whenToUse: '',
    triggers: [],
    does: '',
    constraints: '',
    raw: description,
  };
  if (!description) return result;
  const text = description.replace(/\r\n/g, '\n');

  const whenRe =
    /Use when:\s*(.+?)(?=\n\s*(?:Triggers:|Does:|NOT for:|Constraints:|Handles:|Capability:|Input:|\n\n)|$)/s;
  const whenMatch = whenRe.exec(text);
  if (whenMatch) result.whenToUse = whenMatch[1].trim();

  if (!result.whenToUse) {
    const m = /Handles:\s*(.+?)(?=\n\s*(?:Capability:|Note:|\n\n)|$)/s.exec(text);
    if (m) result.whenToUse = m[1].trim();
  }

  const triggersRe = /Triggers:\s*(.+?)(?=\n\s*(?:Does:|NOT for:|Constraints:|\n\n)|$)/s;
  const triggersMatch = triggersRe.exec(text);
  if (triggersMatch) {
    const t = triggersMatch[1];
    result.triggers = [...t.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    if (result.triggers.length === 0) {
      result.triggers = t
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.includes('\n'));
    }
  }

  const doesMatch = /Does:\s*(.+?)(?=\n\s*(?:NOT for:|Constraints:|\n\n)|$)/s.exec(text);
  if (doesMatch) result.does = doesMatch[1].trim();

  if (!result.does) {
    const m = /Capability:\s*(.+?)(?=\n\s*(?:Note:|\n\n)|$)/s.exec(text);
    if (m) result.does = m[1].trim();
  }

  const constraintsMatch = /(?:NOT for|Constraints):\s*(.+?)(?=\n\n|$)/s.exec(text);
  if (constraintsMatch) result.constraints = constraintsMatch[1].trim();

  return result;
}

const ACRONYMS = new Set(['pr', 'ci', 'dag', 'prd', 'api', 'ai']);

export function getWorkflowDisplayName(name: string): string {
  return name
    .replace(/^anvil-/, '')
    .split('-')
    .map(w => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export type WorkflowCategory = 'All' | 'CI/CD' | 'Code Review' | 'Automation' | 'Development';

export const CATEGORIES: WorkflowCategory[] = [
  'All',
  'CI/CD',
  'Code Review',
  'Automation',
  'Development',
];

export function getWorkflowCategory(name: string, description: string): WorkflowCategory {
  const lower = `${name} ${description}`.toLowerCase();
  if (lower.includes('review')) return 'Code Review';
  if (lower.includes('validate') || lower.includes('test-loop') || /\bci\b/.test(lower))
    return 'CI/CD';
  if (
    lower.includes('create-issue') ||
    lower.includes('resolve-conflict') ||
    lower.includes('refactor') ||
    lower.includes('fix-github-issue') ||
    lower.includes('ralph')
  )
    return 'Automation';
  if (
    lower.includes('feature') ||
    lower.includes('implement') ||
    lower.includes('plan') ||
    lower.includes('architect') ||
    lower.includes('assist') ||
    lower.includes('idea-to-pr') ||
    lower.includes('remotion')
  )
    return 'Development';
  return 'Development';
}

export function getWorkflowTags(
  name: string,
  parsed: ParsedDescription,
  explicitTags?: string[]
): string[] {
  if (explicitTags !== undefined) return [...new Set(explicitTags)];
  const tags: string[] = [];
  const text = `${name} ${parsed.raw}`.toLowerCase();
  if (text.includes('github') || text.includes('issue') || text.includes('pr')) tags.push('GitHub');
  if (text.includes('parallel') || text.includes('agent') || text.includes('ralph'))
    tags.push('Agent');
  if (text.includes('review')) tags.push('Review');
  if (text.includes('test') || text.includes('validation') || text.includes('validate'))
    tags.push('Testing');
  if (text.includes('refactor')) tags.push('Refactor');
  if (text.includes('conflict') || text.includes('merge')) tags.push('Git');
  if (text.includes('plan') || text.includes('prd') || text.includes('architect'))
    tags.push('Planning');
  return [...new Set(tags)];
}

export type WorkflowIconName =
  | 'Bug'
  | 'GitMerge'
  | 'Rocket'
  | 'RefreshCw'
  | 'TestTube'
  | 'Workflow'
  | 'Eye'
  | 'Lightbulb'
  | 'Wrench'
  | 'Zap'
  | 'Bot';

export function getWorkflowIconName(name: string, category: WorkflowCategory): WorkflowIconName {
  const lower = name.toLowerCase();
  if (lower.includes('issue') || lower.includes('bug') || lower.includes('fix')) return 'Bug';
  if (lower.includes('review')) return 'Eye';
  if (lower.includes('conflict') || lower.includes('merge')) return 'GitMerge';
  if (lower.includes('feature') || lower.includes('idea') || lower.includes('remotion'))
    return 'Rocket';
  if (lower.includes('refactor')) return 'RefreshCw';
  if (lower.includes('test') || lower.includes('validate')) return 'TestTube';
  if (lower.includes('plan') || lower.includes('prd') || lower.includes('architect'))
    return 'Lightbulb';
  if (lower.includes('ralph')) return 'Bot';
  if (lower.includes('assist')) return 'Wrench';
  switch (category) {
    case 'Code Review':
      return 'Eye';
    case 'CI/CD':
      return 'TestTube';
    case 'Automation':
      return 'Zap';
    case 'Development':
      return 'Rocket';
    default:
      return 'Workflow';
  }
}
