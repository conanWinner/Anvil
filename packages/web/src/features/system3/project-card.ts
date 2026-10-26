import type { System3ProjectResponse } from '@/lib/api';

export interface ProjectCardStatus {
  label: string;
  tone: 'neutral' | 'running' | 'warn' | 'good' | 'bad';
  hint: string;
}

const STAGES: Record<System3ProjectResponse['stage'], ProjectCardStatus> = {
  draft: { label: 'Mới tạo', tone: 'neutral', hint: 'Bắt đầu phân tích bài toán' },
  understanding: { label: 'Đang phân tích', tone: 'running', hint: 'Xem và chấp nhận Bản hiểu' },
  workflow_design: {
    label: 'Chuẩn bị kế hoạch',
    tone: 'running',
    hint: 'Kiểm tra điều kiện trước khi chạy',
  },
  approved: { label: 'Đã phê duyệt', tone: 'neutral', hint: 'Kế hoạch sẵn sàng để chạy' },
  executing: { label: 'Đang chạy', tone: 'running', hint: 'Các LLM đang chạy trong sandbox' },
  verifying: { label: 'Đang kiểm tra', tone: 'running', hint: 'Đang chấm bằng bộ kiểm tra chung' },
  delivery: { label: 'Có kết quả', tone: 'good', hint: 'Xem kết quả và tải gói' },
  delivered: { label: 'Đã bàn giao', tone: 'good', hint: 'Xem kết quả hoặc tải lại gói' },
};

/** Plain-language status for the project list; attention and staleness win over the stage. */
export function presentProjectCard(
  project: Pick<System3ProjectResponse, 'stage' | 'attention' | 'freshness'>
): ProjectCardStatus {
  if (project.attention === 'failed')
    return { label: 'Gặp lỗi', tone: 'bad', hint: 'Mở dự án để xem lỗi và cách xử lý' };
  if (project.freshness !== 'current')
    return { label: 'Cần chạy lại', tone: 'warn', hint: 'Nguồn đã thay đổi sau lần chạy trước' };
  if (project.attention === 'input_required')
    return { label: 'Cần bổ sung', tone: 'warn', hint: 'Thiếu nguồn, dữ liệu hoặc cấu hình' };
  if (project.attention === 'decision_required')
    return { label: 'Chờ bạn trả lời', tone: 'warn', hint: 'Có câu hỏi cần xác nhận' };
  if (project.attention === 'approval_required')
    return { label: 'Chờ phê duyệt', tone: 'warn', hint: 'Kế hoạch đã sẵn sàng để duyệt' };
  return STAGES[project.stage];
}
