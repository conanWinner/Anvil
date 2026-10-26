# Cấu hình 9router qua Pi

Anvil dùng provider Pi hiện có để gọi gateway 9router qua OpenAI-compatible Chat Completions; không cần thêm adapter. Model ref có dạng `router9/<model-id>`, giữ nguyên dấu `/` bên trong model ID. Alias `9router/...` không hợp parser vì provider ID phải bắt đầu bằng chữ.

## 1. Khai báo gateway và model

Tạo hoặc chỉnh `~/.pi/agent/models.json`, giữ các provider khác đang dùng. Mẫu dưới dùng gateway local; thay URL, model IDs, context window và giới hạn token theo instance thực tế. Các con số chỉ minh họa, không phải thông số đã xác minh của model.

```json
{
  "providers": {
    "router9": {
      "baseUrl": "http://127.0.0.1:20128/v1",
      "api": "openai-completions",
      "apiKey": "$ROUTER9_API_KEY",
      "models": [
        {
          "id": "<model-id-1>",
          "name": "Model 1",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "<model-id-2>",
          "name": "Model 2",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Cấp `ROUTER9_API_KEY` cho tiến trình Anvil qua môi trường hoặc `~/.anvil/.env`; không ghi khóa vào repo, prompt hay log. Pi phân giải `$ROUTER9_API_KEY`. Cấu hình Codex riêng không tự được Pi sử dụng. Các trường cost bằng 0 trong mẫu không có nghĩa model miễn phí: comparison hiện ghi usage/chi phí **chưa biết**.

Muốn tách cấu hình thử nghiệm, đặt `PI_CODING_AGENT_DIR` tới thư mục chứa `models.json` riêng trước khi khởi động Anvil. SDK đang dùng `ModelRegistry.create(authStorage)`; Anvil chưa expose tham số đường dẫn registry riêng.

## 2. Chọn model trong Anvil

Ở form tạo dự án, mở **So sánh nhiều LLM**, bật comparison và nhập 2–4 model khác nhau, mỗi model một dòng:

```text
router9/<model-id-1>
router9/<model-id-2>
```

Nhập prompt chung, requirement IDs và tải harness `.py`. Mỗi model đã chọn cần có định nghĩa tương ứng trong registry Pi; Anvil không tự đổi sang model dự phòng.

Nếu dùng Pi làm assistant mặc định, đặt trong `~/.anvil/config.yaml`:

```yaml
defaultAssistant: pi
assistants:
  pi:
    model: router9/<model-id-1>
```

## 3. Kiểm tra và giới hạn

- Chạy `bun run cli doctor` để kiểm tra môi trường. Lệnh này không thay thế một request thật qua gateway; `GET /models` thành công cũng chưa chứng minh chat/credential hợp lệ.
- Ngày 16/10/2026 đã chạy hai model `router9/cx/gpt-6-luna` và `router9/cx/gpt-5.6-luna` trên cùng CSV qua Web, Verify và Delivery; đã tải gói và tái chạy. Streaming rồi hủy và timeout qua `PiProvider.sendQuery` cũng đã được kiểm tra.
- Đây là kiểm chứng theo thời điểm trên bài toán đếm dòng; chưa nghiệm thu dữ liệu nghiệp vụ, nút hủy từng model trên Web hoặc mọi capability của gateway. Chi tiết bằng chứng, lệnh và giới hạn tại [kế hoạch 11](11-simplification-and-core-flow-plan.md).
- Structured output của Pi là best-effort: đường thực thi Anvil phải xác thực schema trước khi nhận kết quả. Sandbox thực thi code còn cần Linux, systemd, bubblewrap và Python; xem giới hạn trong 11.

[← README dự án](../../README.md) · [Mục lục kỹ thuật](README.md)
