# 17 — Vận hành System 3 trên production

Ngày: 30/10/2026. Trạng thái: **hướng dẫn chưa được chạy trên máy production**; xem §6.

## 1. Mô hình triển khai

Một bản cài cho một khách, chạy từ source trên Linux, một tiến trình server, SQLite. Không chạy nhiều tiến trình: hàng đợi sandbox chỉ nằm trong một tiến trình ([review 14](14-code-and-process-review-2026-10-28.md) §2).

**Không dùng Docker image cho System 3.** Image phục vụ được UI/API nhưng không có bubblewrap, systemd-run và runtime ML, nên không chạy được phương án. Không bật privileged container hoặc mount socket systemd để vượt giới hạn này.

## 2. Chuẩn bị máy

- Yêu cầu cài đặt theo [README](../../README.md). Mỗi phương án cần 2 GB RAM và 2 CPU; số phương án chạy song song tính theo cấu hình máy.
- Tạo user thường `anvil`, không chạy server bằng root. Sandbox dùng systemd user manager, nên phải bật linger: `loginctl enable-linger anvil`.
- `ANVIL_HOME` đặt trên đĩa, ví dụ `/var/lib/anvil`. Không đặt trên `/tmp` vì có thể là tmpfs.
- Cấu hình model theo [doc 12](12-9router-setup.md). Khóa API để trong file chỉ `anvil` đọc được.

```bash
bun install --frozen-lockfile
bun run build:web
ANVIL_HOME=/var/lib/anvil bun run system3:ml-runtime
```

## 3. Chạy server

Mặc định server nghe trên `0.0.0.0` và **không có đăng nhập** khi dùng SQLite (Better Auth chỉ bật với PostgreSQL). Ai vào được cổng này đều tải dữ liệu lên và tiêu token được, nên bắt buộc đặt `HOST=127.0.0.1` và để reverse proxy có xác thực đứng trước.

`/etc/systemd/system/anvil.service`:

```ini
[Unit]
Description=Anvil
After=network-online.target user@1001.service
Wants=network-online.target

[Service]
User=anvil
WorkingDirectory=/opt/anvil
Environment=ANVIL_HOME=/var/lib/anvil HOST=127.0.0.1 PORT=3090
Environment=XDG_RUNTIME_DIR=/run/user/1001
EnvironmentFile=/etc/anvil/anvil.env
ExecStart=/usr/local/bin/bun run start
Restart=on-failure
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

Thay `1001` bằng UID của `anvil`.

`Caddyfile`:

```caddyfile
anvil.example.com {
	basic_auth {
		admin <hash từ `caddy hash-password`>
	}
	reverse_proxy 127.0.0.1:3090
}
```

## 4. Kiểm tra sau khi triển khai

1. `GET /api/health` trả 200 qua proxy; không có xác thực thì trang chính trả 401; cổng 3090 không truy cập được từ ngoài.
2. Trên máy production: `ANVIL_SANDBOX_TESTS=true bun --filter @anvil/system3 test`. Test bị bỏ qua không tính là đạt.
3. Chạy một luồng bộ mẫu Olist qua web tới bàn giao, tải gói và chạy `reproduce.sh`.

## 5. Sao lưu, nâng cấp và quay lui

- Sao lưu cả `ANVIL_HOME`: `anvil.db` (dùng `sqlite3 anvil.db ".backup ..."` khi server đang chạy) và `workspaces/`. Nguồn, artifact, gói bàn giao nằm trong `workspaces/`, chỉ có DB thì không đủ.
- Nâng cấp: sao lưu → dừng server khi không có lượt chạy → đổi revision → `bun install --frozen-lockfile` → `bun run build:web` → khởi động → làm lại §4.1.
- Quay lui: dừng server → khôi phục revision và bản sao lưu cùng thời điểm. Schema chỉ thêm, nhưng bản cũ không đảm bảo đọc được dữ liệu mới, nên không quay lui revision mà giữ DB mới.
- Không dọn `workspaces/` bằng tay: Evidence và gói bàn giao trỏ tới file trong đó.

## 6. Giới hạn đã biết

- **Chưa chạy thử:** unit, Caddyfile và các bước trên chưa từng chạy trên máy production. Sandbox và luồng web đã chạy thật bằng user thường trên máy dev qua `~/anvil-e2e`.
- Chưa có trần chi phí token; số lượt gọi agent chỉ bị chặn bởi số vòng sửa.
- Chỉ hỗ trợ phân loại nhị phân trên dữ liệu bảng; chưa trả lời câu hỏi của agent ngay trên UI.
- Độ phủ yêu cầu còn thấp: mới có `golden_cases` và `manual`, nên hầu hết yêu cầu vẫn là `not_verified` ([kế hoạch 16](16-blueprint-verification-contract-plan.md)).
- Chính sách lỗi review chưa chốt: người dùng vẫn chạy được khi còn lỗi chặn mà không phải ghi nhận ngoại lệ ([review 14](14-code-and-process-review-2026-10-28.md) C1).

[← Mục lục kỹ thuật](README.md) · [Kế hoạch hiện hành](13-experiment-execution-plan.md)
