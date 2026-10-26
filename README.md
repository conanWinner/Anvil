# Anvil

Anvil là nền tảng điều khiển AI coding assistant qua Web, CLI và các adapter. Trọng tâm phát triển hiện tại: **chạy nhiều LLM trên cùng bài toán và dữ liệu**, xem code/kết quả riêng, kiểm tra bằng cùng bộ tiêu chí và tải gói chạy lại.

Đã kiểm chứng luồng hai LLM qua **9router** trên CSV thử nghiệm ngày 16/10/2026. Đây vẫn là bản đang phát triển; chưa nghiệm thu bài toán thực tế hoặc toàn bộ `validate`.

## Chạy từ mã nguồn

Cần Git và [Bun 1.3+](https://bun.sh). Luồng chạy code nhiều LLM cần Linux, Python 3, systemd và bubblewrap >= 0.9, cùng quyền tạo sandbox. Mặc định dùng SQLite; không cần PostgreSQL.

```bash
git clone https://github.com/conanWinner/Anvil
cd Anvil
bun install
```

[Cấu hình 9router qua Pi](docs/technical/12-9router-setup.md), sau đó mở hai terminal tại thư mục Anvil:

```bash
# Terminal 1: API
HOST=127.0.0.1 bun run dev:server

# Terminal 2: Web
bun run dev:web
```

Mở **http://localhost:5173/console/projects**. Trên VPS, dùng SSH tunnel tới các cổng 5173 và 3090. Chạy riêng Web/API để tránh khởi động thêm dịch vụ không cần thiết trên máy ít tài nguyên.

## Luồng cốt lõi

1. Chọn **Dùng bộ mẫu Olist**, chọn 2–4 LLM và **Tạo dự án**. Mẫu có sẵn bài toán, CSV, prompt và bộ kiểm tra. Với tệp riêng, tải Markdown/CSV và mở **Cấu hình bộ kiểm tra và nâng cao**.
2. Chọn **Bắt đầu phân tích**, xử lý Decision và chấp nhận Bản hiểu. Anvil kiểm tra sẵn sàng và chuẩn bị kế hoạch.
3. Xem kế hoạch rồi **Phê duyệt và chạy**. Các model chạy tuần tự trên cùng dữ liệu đã ghim; Anvil xác minh từng kết quả bằng harness chung.
4. Xem code, output và Evidence; chủ động yêu cầu bàn giao rồi tải gói chạy lại.

Hiện chỉ chạy Python dùng thư viện chuẩn, đọc CSV và xuất JSON; bài toán riêng cần tiêu chí/harness của người dùng. Chưa nghiệm thu 3–4 model, hủy từng model qua Web hoặc phục hồi khi server khởi động lại. Blueprint cần cấu trúc sáu phần; chưa hỗ trợ mọi bài toán.

## Tài liệu

| Cần làm gì                            | Đọc                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tìm đúng tài liệu                     | [Mục lục docs](docs/README.md)                                                             |
| Hiểu đầu vào, đầu ra và kiến trúc     | [Tổng quan](docs/1.%20Tổng%20quan%20hệ%20thống.md)                                         |
| Cấu hình provider                     | [9router qua Pi](docs/technical/12-9router-setup.md)                                       |
| Tiếp tục triển khai                   | [Kế hoạch hiện hành và bằng chứng](docs/technical/11-simplification-and-core-flow-plan.md) |
| Sửa code và kiểm tra                  | [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md)                                |
| Tra cứu CLI, YAML workflow và adapter | [Tài liệu runtime](https://anvil.diy/reference/cli/)                                       |

Workflow Builder, marketplace và Slack/Telegram/GitHub là các khả năng của nền tảng; không cần cấu hình chúng để bắt đầu luồng trên.

## Telemetry

Anvil có telemetry sử dụng. Đặt `ANVIL_TELEMETRY_DISABLED=1` để tắt; xem [dữ liệu thu thập và các tùy chọn](packages/docs-web/src/content/docs/reference/security.md#anonymous-telemetry).

[MIT License](LICENSE)
