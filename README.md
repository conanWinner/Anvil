# Anvil

Anvil là nền tảng điều khiển AI coding assistant qua Web, CLI và các adapter. Trọng tâm phát triển hiện tại: **triển khai nhanh các phương án thí nghiệm do System 2 đề ra** — agent viết code theo blueprint, agent khác review, Anvil chạy từng phương án trong sandbox, tự chấm trên tập kiểm tra giữ riêng, gợi ý kèm thống kê và để người dùng chọn.

Đã nghiệm thu qua Web với model thật qua **9router** trên bộ mẫu Olist (dự đoán đơn bị đánh giá thấp, 4 phương án model) ngày 27/10/2026. Đây vẫn là bản đang phát triển.

## Chạy từ mã nguồn

Cần Git, [Bun 1.3+](https://bun.sh) và Linux có Python 3.12, systemd, bubblewrap >= 0.9, [uv](https://docs.astral.sh/uv/) và `libgomp1`, cùng quyền tạo sandbox. Mặc định dùng SQLite; không cần PostgreSQL.

```bash
git clone https://github.com/conanWinner/Anvil
cd Anvil
bun install
bun run system3:ml-runtime   # cài runtime ML đã khóa phiên bản vào $ANVIL_HOME (một lần)
```

[Cấu hình 9router qua Pi](docs/technical/12-9router-setup.md) (model thi công cần context ≥ 200k, output ≥ 32k), sau đó mở hai terminal tại thư mục Anvil:

```bash
# Terminal 1: API
HOST=127.0.0.1 bun run dev:server

# Terminal 2: Web
bun run dev:web
```

Mở **http://localhost:5173/console/projects**. Trên VPS, dùng SSH tunnel tới cổng 5173 (Web tự chuyển `/api` sang 3090). Chạy riêng Web/API để tránh khởi động thêm dịch vụ không cần thiết trên máy ít tài nguyên.

## Luồng cốt lõi

1. **Tạo dự án:** chọn **Dùng bộ mẫu Olist** (hoặc tải blueprint System 2 và các CSV), chọn agent thi công và agent review, rồi **Tạo và bắt đầu phân tích**.
2. **Phân tích:** xem Bản hiểu (phương án, metric chính, ngưỡng, cách chia dữ liệu) và **Chấp nhận Bản hiểu**; Anvil kiểm tra sẵn sàng và chuẩn bị kế hoạch.
3. **Phê duyệt:** xem kế hoạch thí nghiệm rồi **Phê duyệt và chạy**. Agent viết code, chạy thử trên mẫu và qua review; nếu blueprint mâu thuẫn, agent dừng và hỏi.
4. **Chọn cách chạy:** ở thẻ **Code đã sẵn sàng**, chọn phương án và số phương án chạy cùng lúc (theo sức máy), rồi chạy. Anvil chấm trên nhãn mà code không thấy.
5. **Kết quả:** xem bảng metric và gợi ý; có thể chạy lại một phần; chọn phương án rồi tải gói chạy lại.

Mỗi phương án chạy offline trong sandbox với tối đa 2 GB RAM, 2 CPU, 30 phút; VPS 4 GB chạy một phương án mỗi lúc. Hiện hỗ trợ phân loại nhị phân trên dữ liệu bảng; chưa có chạy ở nơi khác (Kaggle) hay trả lời câu hỏi của agent ngay trên giao diện — xem [kế hoạch 13](docs/technical/13-experiment-execution-plan.md). Chế độ cũ so sánh nhiều LLM trên cùng bài toán vẫn chọn được trên form.

## Tài liệu

| Cần làm gì                            | Đọc                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tìm đúng tài liệu                     | [Mục lục docs](docs/README.md)                                                             |
| Hiểu đầu vào, đầu ra và kiến trúc     | [Tổng quan](docs/1.%20Tổng%20quan%20hệ%20thống.md)                                         |
| Cấu hình provider                     | [9router qua Pi](docs/technical/12-9router-setup.md)                                       |
| Tiếp tục triển khai                   | [Kế hoạch hiện hành và bằng chứng](docs/technical/13-experiment-execution-plan.md) |
| Sửa code và kiểm tra                  | [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md)                                |
| Tra cứu CLI, YAML workflow và adapter | [Tài liệu runtime](https://anvil.diy/reference/cli/)                                       |

Workflow Builder, marketplace và Slack/Telegram/GitHub là các khả năng của nền tảng; không cần cấu hình chúng để bắt đầu luồng trên.

## Telemetry

Anvil có telemetry sử dụng. Đặt `ANVIL_TELEMETRY_DISABLED=1` để tắt; xem [dữ liệu thu thập và các tùy chọn](packages/docs-web/src/content/docs/reference/security.md#anonymous-telemetry).

[MIT License](LICENSE)
