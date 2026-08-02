import { useState, type ReactElement } from 'react';
import type { WorkflowNodeData } from '../../types';
import { TextAreaField } from './fields';

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function WorkflowFields({
  data,
  onChange,
  availableWorkflows,
}: {
  data: WorkflowNodeData;
  onChange: (next: WorkflowNodeData) => void;
  availableWorkflows?: readonly string[];
}): ReactElement {
  const [inputsText, setInputsText] = useState(() => JSON.stringify(data.inputs ?? {}, null, 2));
  const [artifactsText, setArtifactsText] = useState(() =>
    JSON.stringify(data.artifacts ?? { inputs: {}, outputs: {} }, null, 2)
  );
  const inputsValid = parseObject(inputsText) !== undefined;
  const artifactsValid = parseObject(artifactsText) !== undefined;
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
          Child workflow
        </span>
        <input
          list="anvil-child-workflows"
          value={data.name}
          placeholder="system3-intake"
          onChange={(event): void => {
            onChange({ ...data, name: event.target.value });
          }}
          className="w-full rounded-[8px] border border-border bg-surface px-2 py-1.5 font-mono text-[12.5px] text-text-primary outline-none"
        />
        <datalist id="anvil-child-workflows">
          {availableWorkflows?.map(name => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <TextAreaField
        label="Typed input mapping (JSON)"
        value={inputsText}
        rows={5}
        onChange={(value): void => {
          setInputsText(value);
          const inputs = parseObject(value);
          if (inputs !== undefined) onChange({ ...data, inputs });
        }}
      />
      {!inputsValid ? (
        <p className="text-[11px] text-error">Input mapping must be a JSON object.</p>
      ) : null}
      <TextAreaField
        label="Artifact mapping (JSON)"
        value={artifactsText}
        rows={6}
        onChange={(value): void => {
          setArtifactsText(value);
          const artifacts = parseObject(value);
          if (artifacts !== undefined)
            onChange({ ...data, artifacts: artifacts as WorkflowNodeData['artifacts'] });
        }}
      />
      {!artifactsValid ? (
        <p className="text-[11px] text-error">Artifact mapping must be a JSON object.</p>
      ) : null}
    </>
  );
}
