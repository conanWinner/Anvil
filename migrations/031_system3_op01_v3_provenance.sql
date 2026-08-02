-- OP-01 V3 repairs artifact presentation metadata without inventing source
-- provenance. Exact source IDs are copied only from an immutable Understanding
-- Input Snapshot that already points at the same Knowledge Snapshot.
UPDATE remote_agent_system3_artifact_versions
SET activity_id = COALESCE(activity_id,
      CASE artifact_kind
        WHEN 'source_intake_report' THEN 'OP-00'
        WHEN 'knowledge_snapshot' THEN 'TW-02'
        WHEN 'baseline_package' THEN 'TW-06'
        WHEN 'verification_report' THEN 'TW-07'
        WHEN 'delivery_package' THEN 'TW-09'
        ELSE NULL
      END),
    display_name = COALESCE(display_name,
      CASE artifact_kind
        WHEN 'source_intake_report' THEN 'Báo cáo tiếp nhận nguồn'
        WHEN 'knowledge_snapshot' THEN 'Bản hiểu dự án'
        WHEN 'baseline_package' THEN 'Gói kết quả thực thi'
        WHEN 'delivery_package' THEN 'Gói bàn giao'
        ELSE artifact_kind
      END),
    summary = COALESCE(summary, 'Kết quả lịch sử được giữ lại để kiểm tra.'),
    media_type = COALESCE(media_type,
      CASE WHEN artifact_kind IN ('baseline_package', 'delivery_package')
           THEN 'application/gzip' ELSE 'application/json' END),
    schema_version = COALESCE(schema_version, 'legacy'),
    visibility = COALESCE(visibility, 'user'),
    status = COALESCE(status, 'current'),
    source_version_ids = COALESCE(source_version_ids, '[]'::jsonb),
    parent_resource_ids = COALESCE(parent_resource_ids, '[]'::jsonb);

UPDATE remote_agent_system3_artifact_versions artifact
SET status = CASE
  WHEN artifact.knowledge_snapshot_id = project.active_knowledge_snapshot_id
    THEN 'current'
  ELSE 'superseded'
END
FROM remote_agent_system3_projects project
WHERE artifact.project_id = project.id
  AND artifact.artifact_kind = 'knowledge_snapshot';

UPDATE remote_agent_system3_artifact_versions artifact
SET source_version_ids = input.source_ids
FROM remote_agent_system3_understanding_input_snapshots input
WHERE artifact.project_id = input.project_id
  AND artifact.knowledge_snapshot_id = input.knowledge_snapshot_id
  AND artifact.artifact_kind = 'knowledge_snapshot'
  AND (artifact.source_version_ids IS NULL OR artifact.source_version_ids = '[]'::jsonb);
