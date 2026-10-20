# AGENTS.md — quy ước làm việc trong repo này

Next.js 16 + React 19 + Tailwind 3. Giao diện và mã nguồn viết bằng **tiếng Việt**.
Tài liệu này là bản tóm tắt ngắn; **không** lặp lại những gì test đã canh.

## 1. Kiểm trước khi nói "xong"

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --cache
npm run test         # vitest run
npm run docs:check   # script kiểm đường dẫn + lệnh trong tài liệu
npm run check        # check-supply-chain.cjs
```

Lint chạy được ở **0 lỗi**. Warning là baseline của repo — đừng sửa chúng và đừng
báo hồi quy khi số warning không tăng.

**Bốn test/flaky đã biết, không phải hồi quy:**

| File | Vì sao đỏ |
|---|---|
| `tests/secret-registry.test.ts` | Ngân sách thời gian ~500ms cho regex chống ReDoS. **Đỏ cả khi chạy riêng** — đo 2026-10-18: 3/5 lần chạy đơn lẻ vẫn đỏ (1, 1, rồi 2 test đỏ). |
| `tests/redteam-picker.test.ts` | Hai ngân sách thời gian (200ms cho query 10k ký tự, 500ms cho 200 model × 1000 lượn — lấy `best` của vài lần chạy). Đỏ khi máy đang tải. Đo 2026-10-18: 5/5 lần chạy riêng đều xanh. |
| `tests/code-mode-escape.test.ts` | Timeout của worker thread. Chạy riêng thì xanh. |
| `tests/launch-desktop.test.ts` | Đỏ nếu cổng 3000 đang bị giữ — launcher thấy server sẵn nên không rơi vào nhánh fallback. Tắt dev server rồi chạy lại. |

> Cách phân biệt với hồi quy thật: **nhìn tên test đỏ**, đừng chỉ nhìn tên file.
> `secret-registry` đỏ trong `describe('chi phí che phải TUYẾN TÍNH trên kết quả
> tool dài (chốt chặn ReDoS)')` và đỏ **cả khi chạy riêng** — nên "chạy riêng thấy
> xanh" KHÔNG phải tiêu chuẩn ở đây. Hai file đầu đều là ngân sách thời gian: đỏ
> theo tải máy, không theo code.
>
> Riêng `secret-registry` còn **cố ý rộng**: budget 500ms nhưng thường chạy
> 280-460ms (đã ghi trong file), và lỗi thật nó bắt là >5s. Nên đỏ ở đây là dấu
> hiệu máy đang bận, **không** phải dấu hiệu rule regex đã chậm.

## 2. Test mới phải chứng minh đỏ trước khi sửa

**Nguyên tắc quan trọng nhất của file này.**

Một test xanh lúc vừa viết không chứng minh nó canh được thứ gì. Trước khi coi
là xong, phải **làm hỏng đúng thứ mà test khoá** rồi chạy lại:

```
bình thường              → xanh
sửa code cho hỏng        → ĐỎ
trả lại                  → xanh
```

Ba cách hỏng đã gặp, đừng lặp lại:

1. **Regex khớp rộng hơn ý nghĩa.** `toMatch(/VyenMark|VyenLogo/)` khớp cả dòng
   `import` — xoá chỗ gọi thật thì test vẫn xanh. Phải có dấu `<` để chỉ khớp
   thẻ JSX, và phải khẳng định điểm cắt có thật trước khi cắt
   (`expect(idx).toBeGreaterThan(-1)`).
2. **Mốc tìm trả `-1`, phép cắt chạy tới hết file.** `slice(indexOf(x))` khi
   `indexOf` trả `-1` là `slice(-1)` — chuỗi 1 ký tự, mọi assert sau đó đều xanh
   vô nghĩa.
3. **Lệnh sửa file hỏng âm thầm.** PowerShell đọc UTF-8 thành ANSI nên
   `.Replace()` với chuỗi tiếng Việt **không khớp và không báo lỗi** — file giữ
   nguyên, test xanh, tưởng là đã kiểm chứng. Dùng
   `[System.IO.File]::ReadAllText/WriteAllText` với `Encoding::UTF8`, rồi **đọc
   lại xác nhận thay đổi đã vào**.

### 2.1. Đừng viết lời hứa trước khi có test

Đo 2026-10-19: cả 8 lần lỗi trong một phiên đều thuộc cùng một dạng — **lời
hứa trong comment viết trước, test viết sau, và test hoá ra không canh đúng cái
lời hứa đó**. Mẫu cụ thể đã gặp:

- "dòng hỏng được bỏ" → bỏ trong RAM, **không cắt file** ⇒ lần ghi sau nối vào
  dòng hỏng.
- "TOCTOU tự bật" → bản sửa **ghi đè** giá trị cũ bằng chính giá trị sẽ so ⇒
  luôn qua.
- "một lượt hỏng không chết cả phiên" → không hề kiểm chuỗi message khi nạp.
- "vết của mọi lệnh ghi/xoá" → hàm ghi file **không** ghi vào nhật ký.
- "mọi channel nguy hiểm đều bị chặn" → thiếu `workspace-set` (đổi gốc workspace).

Luật: **muốn viết một lời hứa về hành vi trong comment thì phải kèm một test đỏ
khi bỏ lớp bảo vệ đi. Không viết được test đỏ ⇒ không viết lời hứa** — hoặc viết
lời hứa đúng phạm vi điều đo được. Ví dụ đúng: đừng viết "ghi một lần là nguyên
tử" (không test nào phân biệt được với ghi từng dòng — file sinh ra giống hệt),
hãy viết "lúc nạp thấy `tool-call` không có `tool-result` thì báo lỗi" (đo được).

### 2.2. Mutation xanh KHÔNG phải là "test tốt" — phải phân biệt

Sau khi viết test, làm hỏng thứ nó khoá. Nếu test **vẫn xanh**, có hai khả năng
và phải phân biệt được, nếu không lần sau bạn sẽ tưởng đã kiểm chứng:

1. **Mutation không áp dụng** (chuỗi lệch, ký tự đặc biệt trong PowerShell).
   Đo 2026-10-19: `timeout_secs` sửa xong, mutation "xoá khối nhân" **không áp
   dụng** vì chuỗi có ký tự đặc biệt — và nếu không kiểm thì tôi đã báo "mutation
   bị bắt" oan. **Luôn xác nhận bản vá đã vào file** trước khi kết luận.
2. **Test rỗng** — nó khẳng định thứ gì khác. Ba dạng đã gặp:
   `expect(true).toBe(true)`; assert "chuỗi có chứa X" trong khi X xuất hiện ở
   nhánh lỗi; đếm bằng bộ đếm đặt **trong test** nên gọi nó cũng làm nó tăng.

### 2.3. Test phải phân biệt được hai cách hiện thực

Hai cách làm có thể cho ra **kết quả giống hệt** thì test không phân biệt được, và
một trong hai có thể sai. Đo 2026-10-19: "ghi cả lô trong một `appendFileSync`" và
"ghi từng dòng một" cho ra file giống hệt — nên "ghi một lần" **không phải** tính
nguyên tử, và cũng không test nào chứng minh được. Khi đó, đừng dựa vào nó; hãy
dựa vào thứ **đo được** (kiểm chuỗi lúc nạp).

## 2.4. Số 0 và kết quả rỗng là kết quả đáng ngờ

Đo 2026-10-19: truyền sai tham số vào hàm quét ⇒ ra **0 file kéo trình duyệt vào**.
Số 0 trông rất hợp lý nên dễ tin — và tin là bảng kiểm kê sai hoàn toàn. Trước khi
kết luận "không có gì", kiểm lại **phép đo** chứ không phải kết quả: thử phép đo
đó trên một thứ **chắc chắn có** và xem nó có ra khác 0 không.

## 2.5. Kế hoạch, test và review — ba tầng không được lệch nhau

Đo 2026-10-20: feature "đường giả lập cho CLI" ship với **1 Critical** — câu trả lời
của model **không bao giờ** được ghi vào transcript (người dùng thấy trên màn hình,
file trên đĩa không có, lượt sau model không biết mình đã trả lời gì).

Không phải "không cẩn thận" — ba tầng lệch nhau:

| Tầng | Ở đâu | Lệch ở đâu |
|---|---|---|
| Tiêu chí (văn xuôi) | `## Review Focus` | *"Transcript của lượt giả lập phải ghi được"* — **không tiêu chí nào có test** |
| Việc (mã) | Task trong plan | Task chỉ nói *"trả `messages.slice(soDauVao)`"* ⇒ **thoả mãn được** khi tiêu chí vẫn sai |
| Kiểm chứng | test + review | test xanh vì kỳ vọng lấy từ code; **không có review** trước khi push |

⇒ Mở rộng §4 cho **KẾ HOẠCH**: văn xuôi không có hiệu lực, kể cả văn xuôi trong plan.

### Luật 1 — Mỗi tiêu chí = một dòng trong bảng "tiêu chí → test"

Plan (trong `docs/superpowers/plans/`, từ 2026-10-20) phải có mục `## Kịch bản & Test`:

```md
## Kịch bản & Test

**Người dùng thấy:** <1-3 câu tiếng Việt: sau khi chạy, người dùng thấy gì>

| # | Tiêu chí | Test |
|---|---|---|
| 1 | <5 từ đầu của tiêu chí trong Review Focus> | `tests/<ten-file>.test.ts` |
```

Mỗi mục đánh số trong `## Review Focus` phải có một dòng bảng tương ứng, và — khi
plan đã xong — file test nêu ở bảng phải **tồn tại**. `tests/plan-traceability.test.ts`
canh đúng hai điều đó ⇒ tiêu chí không có dòng thì **ĐỎ**.

**Test KHÔNG canh được** việc dòng bảng có thật sự phủ tiêu chí hay không: đã thử
ràng buộc bằng cách so cụm từ dẫn nhập và nó **bắt oan** một plan hợp lệ (tiêu chí
"Màn hình" ↔ dòng bảng nói "Transcript … cùng block" — cùng thứ nhưng không dùng
chung từ nào). ⇒ Văn xuôi trong bảng vẫn phải được **đọc** (bởi agent và reviewer),
không có test nào thay được. Đừng hứa quá thứ test canh.

Câu `**Người dùng thấy:**` viết **trước** khi code: đó là thứ duy nhất tự đặt ra
ranh giới quan sát mà tác giả plan không nghĩ tới.

### Luật 2 — Kỳ vọng lấy từ YÊU CẦU, không lấy từ code

Số/giá trị trong kỳ vọng phải suy ra từ yêu cầu — **không** từ "tôi vừa viết ra
gì". Đo 2026-10-20: `expect(r.messages.length).toBe(2)` — con số 2 đếm từ code ⇒
test xanh vì code đúng như tôi viết, không phải vì hành vi đúng. Dấu hiệu: đổi
implementation (thêm/bớt một message) thì kỳ vọng phải **đổi theo**.

### Luật 3 — Mỗi feature có ≥ 1 test kịch bản end-to-end

Ở ranh giới **quan sát được**: file trên đĩa, output thật, exit code. Test tầng hàm
không bắt được lỗi tầng hệ thống — đó chính là Critical của lượt 6.

### Luật 4 — Review độc lập là BẮT BUỘC trước khi push

Skill `requesting-code-review`. Đo 2026-10-20: lượt implement đường giả lập đã
**push 4 commit** mà không gọi review — và reviewer sau đó bắt đúng Critical đó.
"Tự đọc lại diff của mình" **không thay thế** được: tự review là hỏng theo cấu trúc
(đọc lại *ý định*, không phải *hành vi*). Reviewer phải được yêu cầu **chạy probe
end-to-end**, không chỉ đọc diff.

### Lý do thường để bỏ qua (đo được)

| Lời giải thích | Thực tế |
|---|---|
| "Tôi đã có `Review Focus` rồi" | Focus là văn xuôi; **Task** mới là thứ được kiểm ⇒ Focus sai mà không ai báo |
| "Test xanh rồi mà" | Xanh vì kỳ vọng lấy từ code (Luật 2) |
| "Mutation bắt được rồi" | Mutation bắt được thứ test **đã khẳng định**; **không** bắt được hành vi **còn thiếu** |
| "Reviewer sẽ bắt" | Không có reviewer thì không ai bắt — lượt 5 đã tự push không review |

**Luật 2/3/4 là quy tắc cho agent, KHÔNG có test canh** (test chỉ canh Luật 1). Đừng
đòi test cho chúng — nhưng cũng đừng coi là "không cần làm".

## 3. Sửa token màu phải sửa cả ba file

`tests/design-system.test.ts` canh chiều hai chiều giữa test, `tailwind.config.ts`
và `app/globals.css`. Sửa một bên thì test đỏ. Đây là hợp đồng, không phải sở
thích — sửa đồng thời cả ba trong một lượt.

Lưu ý cấu trúc: `brand-lime`, `brand-mid`, `brand-deep` là `token('--brand-…')`
(đọc từ CSS). `brand` là **hex viết thẳng**, không có biến `--brand` trong
`globals.css`.

## 4. Tài liệu

**Tài liệu không có hiệu lực. Test mới có.** Đo 2026-10-18: xoá hẳn `DESIGN.md`
khỏi repo thì `tests/design-system.test.ts` vẫn 47/47 xanh. Không test nào đọc
nội dung tài liệu.

Hệ quả: tài liệu viết ở thì mệnh lệnh nhưng không mệnh lệnh nào được canh sẽ
lệch dần khỏi code mà vẫn trông như luật, và agent sẽ tuân thủ luật đã chết. Vì
vậy:

**Cùng nguyên tắc này áp cho KẾ HOẠCH** — xem mục 2.5. `## Review Focus` viết bằng
văn xuôi không có hiệu lực; chỉ bảng "tiêu chí → test" mới có.

- `DESIGN.md` — định hướng ngắn, không phải hợp đồng.
- `PLAN.md`, `PLAN-ui-audit.md` ở gốc repo — **lịch sử**, đã dánh nhãn.
- `docs/DESIGN-2026-10-06.md` — bản `DESIGN.md` cũ, lưu trữ.

`npm run docs:check` dùng `git ls-files`, nên **file mới phải `git add` trước**
thì nó mới được theo dõi — không add thì checker báo sai.

## 5. Ngôn ngữ

| Chỗ | Dấu tiếng Việt |
|---|---|
| Comment trong code, tài liệu | **CÓ** |
| Tin nhắn commit | **KHÔNG** (`fix(agents): sua Critical cua reviewer`) |

Commit theo `type(scope): mô tả`, scope là vùng code (`agents`, `brand`, `ui`…).

## 6. Code chết thì xoá hẳn

Chủ repo đã dặn: *"cái nào không cần thì xoá hết, không giữ lại"*. Đừng giữ lại
vì "có thể sau này cần" — và đừng refactor code không liên quan tới việc đang
làm. Xoá rồi để lại comment giải thích **vì sao** xoá, để người sau không thêm
lại.

### Trước khi viết cái mới: dùng lại cái đang có

Chủ repo: *"không tận dụng lại càng tận dụng lại sản phẩm càng như cái bãi rác
chắt vá thôi"*. Viết thêm cơ chế thứ hai cho một việc đã có cơ chế là **chắt vá**,
dù cơ chế cũ chưa hoàn hảo.

Trước khi tạo file/hằng/hàm mới, hãy trả lời bằng grep: việc này đã có ai làm
chưa? Nếu có — **mở rộng nó**, đừng viết song song. Repo có tiền lệ: `shell_run`
đã tự lưu output dài ra file tạm + trả đường dẫn đọc tiếp (`lib/ipc.cjs`), nên
làm "kết quả tool lớn vẫn đọc lại được" thì mở rộng cái đó, không dựng hệ thống
mới.

Hai hệ quả cụ thể đã gặp ở Vyen:

- **Hai bộ hằng trùng tên khác nơi** — `lib/mcp/tool-router.ts` và
  `lib/zeromem/retriever.ts` cùng khai BM25. Cùng giá trị nên chưa lệch, nhưng
  hôm nào lệch là không ai biết vì sao. Đừng lặp lại: hằng dùng chung thì để
  một chỗ.
- **Hai cơ chế lọc tool cùng lúc chạy** — module `capability-projection` từng
  lọc MCP tool song song với Tool Router, bằng byte ước lượng bịa đặt; đã xoá
  2026-10-18. Rác nguy hiểm nhất không phải code mồ côi — mà là code **vẫn
  chạy**, dùng **số liệu bịa**, và không ai thấy.

### Trước khi xoá: tìm không ra KHÔNG phải bằng chứng

Đã suýt xoá nhầm code đang chạy. Nguyên nhân:

```powershell
Select-String -Path "app\**\*.ts" -Pattern "foo"   # KHÔNG recurse như tưởng
```

`**` trong PowerShell không luôn đệ quy — lệnh trên bỏ sót `app/api/chat/route.ts`,
nên kết luận một module lọc tool là chết, trong khi `route.ts:73` đang import nó.
Đây là hướng sai chết người: tìm-hụt dễ dẫn tới xoá nhầm.

Bốn điều phải làm trước khi kết luận "chết":

1. **Thử lệnh tìm lên một thứ chắc chắn còn sống** và xác nhận nó tìm thấy.
   Lệnh không tìm thấy thứ *đáng ra* phải thấy thì lệnh đó vô dụng.
2. **Không tin kết quả rỗng khi lệnh vừa in lỗi.** Regex sai làm `Select-String`
   ném lỗi *cho từng file* rồi trả kết quả rỗng với exit 0.
3. **Dùng công cụ recurse thật**: `rg`, tool `grep`, hoặc
   `Get-ChildItem -Recurse`. Không tin `**` trong PowerShell.
4. **Quét cả cây, không chỉ thư mục code.** Ký hiệu còn sống có thể nằm trong
   `tests/`, fixture, file cấu hình, hoặc chỉ xuất hiện dưới dạng *chuỗi* —
   tên hàm lắp vào đường dẫn, key tra cứu động. Grep tên hàm thôi sẽ không
   thấy, nên "không có kết quả" vẫn có thể là "còn đang dùng".

Cùng dạng với mục 3 của §2: thao tác im lặng không báo lỗi, kết quả sai, tưởng
đã kiểm chứng.

## 7. Đơn vị và định danh phải khớp — đây là nơi lỗi "âm thầm" hay nằm nhất

### 7.1. Đơn vị giữa schema và backend phải khớp

Đo 2026-10-19: `shell_run` nhận `timeout_secs` (schema: 1…600 **giây**). Bảng đổi
tên tham số đưa nó thành `timeoutMs` (backend: `min(1_000)` **mili giây**) ⇒ **mọi
giá trị schema cho phép đều bị zod từ chối ⇒ lệnh không bao giờ chạy**. Tệ hơn:
không đổi tên thì lệnh vẫn chạy với mặc định.

Cùng lượt đó, bản sửa kế tiếp nhân 1000 cho **mọi** tool ⇒ `bg_run` (schema và
backend **đều** dùng giây) bị phá, mọi job chạy 3600 giây.

Luật:

- Đổi tên tham số **không** đổi được đơn vị. Khác đơn vị thì phải **chuyển đổi**,
  và chuyển đổi phải **theo từng tool** chứ không phải theo tên tham số.
- Trước khi tin một tên tham số đã "khớp", mở schema **và** schema của backend ra
  đặt cạnh nhau, đọc **min/max và đơn vị** của cả hai.

### 7.2. Đừng dùng chuỗi người dùng (hoặc model) làm khoá

Đo 2026-10-19: khoá hash chống TOCTOU lấy theo **đúng chuỗi** `a.path` mà model
đưa. Nên:

```
đọc "a.txt"         → ghi "a.txt"         ⇒ bị chặn  ✔
đọc "a.txt"         → ghi "./a.txt"       ⇒ KHÔNG bị chặn  ✘
đọc "a.txt"         → ghi "A.TXT"         ⇒ KHÔNG bị chặn  ✘  (Windows không phân biệt hoa/thường)
```

Cả ba là **cùng một file**. Không chỉ là lỗi người dùng: văn bản do model sinh ra
có thể bị chèn (prompt injection) và bảo nó ghi `package.json` — đúng lúc đó lớp
bảo vệ biến mất âm thầm.

Luật: **khoá theo dạng đã chuẩn hoá** (`path.resolve` + hạ chữ hoa trên hệ điều
hành không phân biệt), không theo chuỗi người dùng gõ. Cùng luật cho mọi thứ
dùng làm khoá: id phiên, tên file, khoá cấu hình.

### 7.3. Đổi hợp đồng thì grep mọi caller

Đổi **signature**, kiểu trả về, hay hành vi của một hàm — code *gọi* nó có
thể vỡ ở chỗ không nằm trong diff. Một thay đổi trông như "chỉ refactor"
đã làm hỏng file khác, mà file đó không đổi nên không ai nhìn thấy.

Luật: trước khi sửa, **grep mọi caller** của hàm đó (tên hàm, tên import, tên
thuộc tính) trên toàn cây. Sửa ở **chỗ dùng chung, một lần** — đừng vá lặp ở
từng caller để "cho xong".

## 8. Kiểm byte khi sửa file — BOM và thay đổi vô nghĩa

Đo 2026-10-19: công cụ ghi file của harness thêm **UTF-8 BOM** vào **mọi** file tạo
mới (10/10 file của tôi), còn 502 file còn lại của repo thì sạch. BOM không làm
hỏng gì (`tsc` và `vitest` đều bỏ qua) — **chính vì vậy nó lọt vào diff mà không ai
báo**, và nó là thay đổi byte vô nghĩa nằm chính giữa thay đổi thật.

Luật:

- File nguồn **không được có BOM**. `tests/repo-hygiene.test.ts` canh điều này.
- Sau khi sửa hàng loạt file, đọc `git diff --stat` và xem có dòng nào đổi cả
  file mà không đổi nội dung không.
- Ký tự đặc biệt trong lệnh sửa file là nguồn lỗi âm thầm: backtick (`) thay vì
  nháy đơn (`'`) làm **parse error**, còn `'` trong PowerShell `.Replace()` với
  chuỗi tiếng Việt lại **không khớp và không báo lỗi** (§2.3).

## 9. Bản đồ nhanh

| Việc | Ở đâu |
|---|---|
| Tool runtime của agent | `core/agent-runtime/` |
| Hook điều phối chat | `react/use-chat-orchestration.ts` |
| Multi-tab lock | `core/agent-runtime/tab-lock.ts` |
| Hình + màu logo | `brand/mark.json` → `components/vyen-logo.tsx` + `scripts/build-icons.cjs` |
| Bảng màu giao diện | `app/globals.css` + `tailwind.config.ts` + `tests/design-system.test.ts` |
| Test hợp đồng design system | `tests/design-system.test.ts` |
| Vị trí logo được phép hiện | `tests/brand-placement.test.ts` |
| **CLI — điểm vào** | `cli/index.ts` (REPL, `-p` cho một lượt) |
| **CLI — vòng lặp tool** | `cli/agent-turn.ts` (`maxSteps`, `abortSignal`) + `cli/repl.ts` (`/exit`, `/new`) |
| **CLI — lưu hội thoại** | `cli/session.ts` (JSONL append-only, một file cho mỗi thư mục) |
| **CLI — cổng duyệt** | `cli/approve.ts` (mặc định KHÔNG) + `cli/terminal.ts` (vòng đời stdin) |
| **CLI — system prompt** | `cli/instructions.ts` (nạp `AGENTS.md`, hướng dẫn tool có điều kiện) |
| **CLI — cầu nối tool** | `lib/tools/ipc-node.ts` (cầu `lib/ipc.cjs`: path-guard, chống TOCTOU, audit) |
| **CLI — bảng kiểm kê** | `docs/cli-migration-inventory.md` + `scripts/cli-migration/` |

## 10. Trước khi báo xong

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test` — không đỏ (trừ 4 flaky ở mục 1)
- [ ] `npm run lint` — không có lỗi mới
- [ ] `npm run docs:check` OK
- [ ] Test mới đã được chứng minh ĐỎ (mục 2)
- [ ] **Mutation đã được xác nhận là thật sự thay đổi hành vi** (mục 2.2)
- [ ] **Mọi lời hứa trong comment mới đều có test đỏ khi bỏ lớp bảo vệ** (mục 2.1)
- [ ] **Kỳ vọng lấy từ yêu cầu, không lấy từ code** (mục 2.5 — Luật 2, *tự khai*)
- [ ] **Có ≥ 1 test kịch bản end-to-end** ở ranh giới quan sát được (mục 2.5 — Luật 3, *tự khai*)
- [ ] **Đã gọi skill `requesting-code-review` trước khi push** (mục 2.5 — Luật 4, *tự khai*)
- [ ] Plan có mục `## Kịch bản & Test`; mọi tiêu chí trong `Review Focus` đều có dòng (mục 2.5 — Luật 1, *có test canh*)
- [ ] File mới đã `git add`
- [ ] File nguồn không có BOM (mục 8)
