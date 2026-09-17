# Chống spam form Web Hỏa Tốc

Trạng thái: frontend đã tích hợp Site key `0x4AAAAAAE5-wJyxSbcuaCuk`, action `lead`.
Mã backend CHƯA được triển khai vào endpoint đang chạy. Chống spam chỉ có hiệu lực
phía máy chủ sau khi cấu hình Script Properties và triển khai Code.gs.

## Cấu hình cần có

1. Trong Cloudflare Dashboard → Turnstile → Add widget, chọn Managed.
   Cho phép hostname `webhoatoc.click`; thêm `cuoilen007.github.io` nếu vẫn dùng địa chỉ
   GitHub Pages và `localhost` nếu cần kiểm thử. Không nhập đường dẫn hay https://.
2. Site key là công khai: cung cấp cho người chỉnh frontend. Widget phải đặt action `lead`.
3. Secret key chỉ nhập trong Apps Script → Project Settings → Script Properties:
   - `TURNSTILE_SECRET_KEY`: Secret key của widget.
   - `TURNSTILE_HOSTNAMES`: `webhoatoc.click,cuoilen007.github.io` (chỉ hostname thực sự dùng).
   Không gửi Secret key qua chat, không commit vào GitHub, không đặt trong HTML.
4. Sau khi frontend đã tích hợp, thay mã Apps Script bằng Code.gs, chạy setup để
   cấp quyền UrlFetch/Sheets/Mail. setup không xóa dữ liệu hiện có.
5. Deploy → Manage deployments → Edit → New version → Deploy.
   Giữ URL endpoint cũ. Nếu tạo URL mới thì frontend cũng cần đổi URL.
6. Kiểm thử bằng widget/key thật: khách hợp lệ tạo một dòng; POST không CAPTCHA,
   CAPTCHA giả/hết hạn, hostname/action sai đều không tạo dòng và không gửi email.
   Thử gửi lặp phải giải CAPTCHA mới, giữ requestId và thông tin như cũ để không nhân bản.

## Chính sách mặc định

- CAPTCHA bắt buộc được xác minh ở máy chủ, cấu hình thiếu/lỗi thì từ chối.
- Tối đa 20 yêu cầu mới/giờ, 60/24 giờ toàn form; mỗi số Việt Nam tối đa 2/24 giờ,
  hai yêu cầu mới cách nhau ít nhất 10 phút. Retry đúng mã và thông tin đã lưu không tính thêm.
- Hạn mức dùng dữ liệu Sheet và khóa máy chủ, không tin IP/timestamp từ trình duyệt.
- Chỉ tự động thử gửi một email cho mỗi yêu cầu. Nếu email lỗi hoặc hết quota,
  khách vẫn được lưu; kiểm tra cột trạng thái để xử lý thủ công.
- Chỉ nhận số điện thoại Việt Nam 10 chữ số hoặc dạng +84 tương đương.
- Không có API đọc/xóa Sheet; chống công thức độc trong dữ liệu nhập.

## Giới hạn và vận hành

Không bảo đảm chống DDoS: Apps Script vẫn nhận request và dùng quota để xác minh.
Hạn mức toàn form có thể bị người vượt CAPTCHA tiêu hao, làm khách thật tạm bị chặn.
Nếu bị tấn công lưu lượng lớn, cần thêm proxy/WAF có giới hạn IP trước Apps Script
và xác thực riêng giữa proxy với Apps Script (không dùng secret trong frontend).
Giới hạn theo số không chứng minh chủ sở hữu số; xác thực SMS là hạng mục riêng.
Với Sheet lớn, việc đọc lịch sử mỗi lần gửi cần chuyển sang kho dữ liệu có chỉ mục.

Giữ Sheet ở chế độ Bị hạn chế, sao lưu định kỳ và bật xác thực hai bước Google.
Không công khai quyền Người xem/Người chỉnh sửa cho danh sách khách.

Tài liệu: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
