import type {
  BlueprintAnalysis,
  System3DatasetProfile,
  System3ManualReview,
  System3Requirement,
} from './contracts';
import { parseSystem3CsvText } from './csv-contract';

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim());
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function boldField(lines: readonly string[], label: string): string | null {
  const wanted = normalized(label);
  for (const line of lines) {
    const match = /^\s*\*\*([^*]+):\*\*\s*(.+?)\s*$/.exec(line);
    if (match?.[1] && match[2] && normalized(match[1]) === wanted) return match[2].trim();
  }
  return null;
}

function quotedJsonField(markdown: string, field: string): string | null {
  const expression = new RegExp(
    `"${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`
  );
  const match = expression.exec(markdown);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}

function parseRequirements(lines: readonly string[]): System3Requirement[] {
  const requirements: System3Requirement[] = [];
  let columns: Map<string, number> | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = tableCells(lines[index] ?? '');
    if (!cells) continue;
    if (
      normalized(cells[0] ?? '') === 'id' &&
      cells.some(cell => normalized(cell) === 'requirement')
    ) {
      columns = new Map(cells.map((cell, column) => [normalized(cell), column]));
      continue;
    }
    const id = cells[0]?.trim() ?? '';
    if (!/^(FR|NFR|DSR)-\d+$/i.test(id)) continue;
    const statement = cells[columns?.get('requirement') ?? 4]?.trim() ?? '';
    if (!statement) continue;
    const acceptanceIndex =
      columns?.get('acceptance criteria') ?? columns?.get('acceptance criterion') ?? 5;
    requirements.push({
      id,
      kind: cells[columns?.get('type') ?? 1]?.trim() || id.split('-')[0] || 'unknown',
      priority: cells[columns?.get('priority') ?? 2]?.trim() || null,
      source: cells[columns?.get('source') ?? 3]?.trim() || null,
      statement,
      acceptanceCriterion:
        cells[acceptanceIndex]?.trim() || 'Requires explicit verification method',
      sourcePointer: `blueprint.md:${String(index + 1)}`,
    });
  }
  return requirements;
}

function parseManualReviews(lines: readonly string[]): System3ManualReview[] {
  return lines.flatMap((line, index) =>
    line.includes('[Manual Review Required]')
      ? [
          {
            id: `manual-review-${String(index + 1)}`,
            text: line.trim(),
            sourcePointer: `blueprint.md:${String(index + 1)}`,
          },
        ]
      : []
  );
}

export function analyzeBlueprintMarkdown(
  markdown: string,
  dataset: System3DatasetProfile | null
): BlueprintAnalysis {
  const lines = markdown.split(/\r?\n/);
  const moduleMatches = markdown.match(/\bDM-\d{2}\b/g) ?? [];
  const targetDefinition =
    quotedJsonField(markdown, 'target_definition') ?? boldField(lines, 'Target Definition');
  const ramMatch = /RAM\s*[≤<]?\s*(\d+)\s*GB/i.exec(markdown) ?? /(\d+)\s*GB\s*RAM/i.exec(markdown);
  return {
    schemaVersion: 1,
    businessGoal: boldField(lines, 'Business Goal'),
    technicalObjective: boldField(lines, 'Technical Objective'),
    targetDefinition,
    runtime: {
      cpuOnly: /CPU-only|CPU only|không có GPU/i.test(markdown),
      ramGb: ramMatch?.[1] ? Number.parseInt(ramMatch[1], 10) : null,
    },
    requirements: parseRequirements(lines),
    modules: [...new Set(moduleMatches)],
    manualReviews: parseManualReviews(lines),
    dataset,
  };
}

export function profileDatasetCsv(
  filename: string,
  text: string,
  targetColumn = 'target'
): System3DatasetProfile {
  const rows = parseSystem3CsvText(text);
  const columns = rows[0] ?? [];
  if (columns.length === 0) throw new Error('Dataset CSV has no header');
  const targetIndex = columns.indexOf(targetColumn);
  const targetDistribution: Record<string, number> = {};
  for (const row of rows.slice(1)) {
    if (targetIndex < 0) continue;
    const value = row[targetIndex]?.trim() ?? '';
    targetDistribution[value] = (targetDistribution[value] ?? 0) + 1;
  }
  return {
    filename,
    rowCount: Math.max(0, rows.length - 1),
    columnCount: columns.length,
    columns,
    targetColumn: targetIndex >= 0 ? targetColumn : null,
    targetExists: targetIndex >= 0,
    targetDistribution,
  };
}
