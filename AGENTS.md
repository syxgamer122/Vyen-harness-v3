# AGENTS.md — quy ước làm việc trong repo này

Next.js 16 + React 19 + Tailwind 3, trên **Windows + PowerShell** (không phải bash).
Giao diện và mã nguồn viết bằng **tiếng Việt**.

- **Next 16 / React 19:** `params`, `searchParams`, `cookies()`, `headers()` là
  Promise ⇒ bắt buộc `await params` (await cả `await searchParams`). React 19 nhận
  `ref` như prop thường, không bọc `forwardRef`. Gặp API lạ thì đọc guide trong
  `node_modules/next/dist/docs/` (block ở cuối file) — đừng đoán.

> **File này nằm trong prompt của MỌI lượt gọi model** (`cli/instructions.ts` nạp nó, cắt
> ở 20.000 ký tự) ⇒ viết **luật**, đừng viết truyện. Bằng chứng và hậu quả của từng
> luật nằm ở ledger (`.superpowers/sdd/*/progress.md`) — đọc **đúng phần lượt hiện
> tại**, đừng đọc cả file.
>
> **Cùng luật cho mọi tài liệu**: repo này có hàng chục nghìn dòng plan/ledger/design
> doc. Chúng là **lịch sử**, không phải đầu vào của lượt làm việc. Một lượt chỉ cần:
> file này + **plan của lượt đang làm** + spec liên quan. Đọc thêm là tự chặn context
> của chính mình.

## 1. Cổng trước khi báo "xong"

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --cache
npm run test         # vitest run
npm run docs:check   # đường dẫn + lệnh trong tài liệu
npm run build        # BẮT BUỘC — typecheck/test vẫn xanh khi package.json hỏng
```

Lint 0 lỗi. Warning là baseline — đừng sửa, đừng báo hồi quy.

**Flaky đã biết** (đỏ theo tải máy, `secret-registry` đỏ **cả khi chạy riêng**):
`tests/secret-registry.test.ts` · `tests/redteam-picker.test.ts` ·
`tests/code-mode-escape.test.ts` · `tests/launch-desktop.test.ts` (cần cổng 3000 rảnh).
Phân biệt hồi quy thật: **nhìn tên test đỏ**, không chỉ tên file.

**Checklist báo xong** — mỗi dòng là điều kiện phải đúng, không phải gợi ý:

- [ ] `npm run typecheck` exit 0 · `npm run test` không đỏ (trừ 4 flaky ở trên) · `npm run lint` không có lỗi mới · `npm run docs:check` OK · `npm run build` exit 0
- [ ] Test mới đã được chứng minh **ĐỎ** trước khi sửa (mục 2) và **mutation đã được xác nhận là thật sự thay đổi hành vi** (mục 2.2)
- [ ] **Mọi lời hứa trong comment mới đều có test đỏ khi bỏ lớp bảo vệ** (mục 2.1)
- [ ] **Kỳ vọng lấy từ yêu cầu, không lấy từ code** (mục 2.5 — Luật 2, *tự khai*)
- [ ] **Có ≥ 1 test kịch bản end-to-end** ở ranh giới quan sát được (mục 2.5 — Luật 3, *tự khai*)
- [ ] **Đã gọi skill `requesting-code-review` trước khi push** (mục 2.5 — Luật 4, *tự khai*)
- [ ] Plan có mục `## Kịch bản & Test`; mọi tiêu chí trong `Review Focus` đều có dòng (mục 2.5 — Luật 1, *có test canh*)
- [ ] File mới đã `git add`; file nguồn không có BOM (mục 8)

### 1.1. Cấm lách cổng & lệnh phá huỷ

Cổng ở trên chỉ có giá trị khi agent **không tự hạ chuẩn** nó.

- **Không hạ chuẩn cổng.** Cấm bỏ qua lỗi kiểu (`@ts-ignore` vô điều kiện;
  `@ts-expect-error` chỉ khi kèm lý do ngay cùng dòng), cấm ép kiểu `as any` để
  qua `tsc`, cấm tắt lint, cấm `--no-verify` khi commit. Lỗi thật thì sửa code,
  không sửa luật. Hai luật về **ép kiểu `as any`** và **tắt lint** áp cho code
  **mới** — không phải để đi dọn kho cũ (mục 6 cấm refactor ngoài phạm vi).
- **Không sửa người canh cổng.** Cấm sửa `tests/plan-traceability.test.ts`,
  `tests/design-system.test.ts`, `tests/repo-hygiene.test.ts`,
  `tests/brand-placement.test.ts` để làm test xanh. Sửa người canh là tự khai
  "tiêu chí sai", không phải sửa tiêu chí. *Ngoại lệ:* khi **luật** ở đây thay
  đổi thì sửa file canh kèm theo, có chủ đích và nói rõ trong commit.
- **Bẻ cong bằng chứng.** Không ghi "đã kiểm" / "đã xong" cho việc chưa chạy. Nêu
  lệnh và kết quả thật (ví dụ `npm run test` → 248/249 file xanh, 1 file flaky).
- **Lệnh phá huỷ.** Cấm `git reset --hard`, `git checkout -- .`, `git restore .`,
  `git clean -fd`, `git push --force` khi chưa hỏi; không đụng thay đổi uncommitted
  không thuộc phạm vi task.
- **Bí mật.** Không in khoá ra transcript, không commit file khoá hay `.env`; khoá
  đi qua kho bí mật của hệ thống (biến môi trường), không hardcode trong code.
  `lib/secret-registry.ts` là nơi **che** khoá khi log, không phải nơi lấy khoá.

> **Phần nào CÓ test, phần nào không** (mục 4: văn xuôi không có hiệu lực).
> `@ts-ignore` vô điều kiện ⇒ **ĐỎ**; `@ts-expect-error` không lý do ⇒ **ĐỎ**
> (`tests/repo-hygiene.test.ts`). File test canh cổng mất marker canh ⇒ **ĐỎ**
> (tripwire, cùng file; hai file canh nhau để không ai xoá được file của nhau).
> Còn lại: ép kiểu `as any`, tắt lint, `--no-verify`, lệnh phá huỷ, bẻ cong
> bằng chứng — **chưa** có cổng đo (đo được thì repo đã có kiểu cổng đếm ở
> `tests/dead-export-scan.test.ts`) ⇒ *tự khai* như Luật 2/3/4.
>
> Đo 2026-10-21: `git grep -c "as any" -- ':!AGENTS.md'` → 186 dòng / 28 file;
> 14 chỗ tắt lint (5 file) ⇒ luật "code mới" áp cho hai luật đó, không phải để
> đi dọn kho cũ.
> Đo 2026-10-21: `lib/shell-policy.cjs` đã chặn `reset`/`clean`/`restore`/`push`
> (allowlist subcommand), nhưng `git checkout -- .` và `git commit --no-verify` thì
> **lọt** ⇒ luật trên bắt đúng phần lọt.
> Giới hạn của tripwire: nó bảo vệ **4 file** trên; file test khác (ví dụ
> `tests/dead-export-scan.test.ts`) nằm ngoài tripwire ⇒ việc nới chúng phải để
> reviewer bắt (mục 2.5 Luật 4).

## 2. Test mới phải chứng minh đỎ trước khi sửa

```
bình thường → xanh · sửa code cho hỏng → ĐỎ · trả lại → xanh
```

Ba cách hỏng đã gặp, đừng lặp lại:

1. **Regex khớp rộng hơn ý nghĩa.** `toMatch(/VyenMark|VyenLogo/)` khớp cả dòng
   `import` ⇒ xoá chỗ gọi thật thì test vẫn xanh. Phải có dấu `<` để chỉ khớp thẻ
   JSX, và phải khẳng định điểm cắt có thật (`expect(idx).toBeGreaterThan(-1)`).
2. **Mốc tìm trả `-1`, phép cắt chạy tới hết file.** `slice(indexOf(x))` khi
   `indexOf` trả `-1` là `slice(-1)` ⇒ mọi assert sau đó xanh vô nghĩa.
3. **Lệnh sửa file hỏng âm thầm.** PowerShell đọc UTF-8 thành ANSI nên `.Replace()`
   với chuỗi tiếng Việt **không khớp và không báo lỗi**. Dùng
   `[System.IO.File]::ReadAllText/WriteAllText` với `Encoding::UTF8`, rồi **đọc lại
   xác nhận thay đổi đã vào**.

### 2.1. Đừng viết lời hứa trước khi có test

**Muốn viết một lời hứa về hành vi trong comment thì phải kèm một test đỏ khi bỏ lớp
bảo vệ đi. Không viết được test đỏ ⇒ không viết lời hứa** — hoặc viết lời hứa đúng
phạm vi điều đo được. Mẫu đã gặp: *"dòng hỏng được bỏ"* (bỏ trong RAM, không cắt file) ·
*"TOCTOU tự bật"* (bản sửa ghi đè giá trị cũ bằng chính giá trị sẽ so) · *"vết của mọi
lệnh ghi/xoá"* (hàm ghi file không ghi vào nhật ký).

### 2.2. Mutation xanh KHÔNG phải là "test tốt" — phải phân biệt

Sau khi viết test, làm hỏng thứ nó khoá. Nếu test **vẫn xanh**, phải phân biệt:

1. **Mutation không áp dụng** (chuỗi lệch, ký tự đặc biệt trong PowerShell) — **luôn
   xác nhận bản vá đã vào file** trước khi kết luận.
2. **Test rỗng** — nó khẳng định thứ gì khác: `expect(true).toBe(true)`; assert "chuỗi
   có chứa X" trong khi X xuất hiện ở nhánh lỗi; đếm bằng bộ đếm đặt **trong test**.

### 2.3. Test phải phân biệt được hai cách hiện thực

Hai cách làm cho ra **kết quả giống hệt** thì test không phân biệt được. Khi đó đừng
dựa vào nó; hãy dựa vào thứ **đo được** (kiểm chuỗi lúc nạp).

### 2.4. Số 0 và kết quả rỗng là kết quả đáng ngờ

Số 0 trông hợp lý nên dễ tin. Trước khi kết luận "không có gì", kiểm lại **phép đo**:
thử phép đó trên một thứ **chắc chắn có** và xem nó có ra khác 0 không.

## 2.5. Kế hoạch, test và review — ba tầng không được lệch nhau

Đo 2026-10-20: feature "đường giả lập cho CLI" ship với **1 Critical** — câu trả lời
của model không bao giờ được ghi vào transcript. Không phải "không cẩn thận": ba tầng
lệch nhau.

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

Mỗi mục đánh số trong `## Review Focus` phải có một dòng bảng tương ứng, và — khi plan
đã xong — file test nêu ở bảng phải **tồn tại**. `tests/plan-traceability.test.ts`
canh đúng hai điều đó ⇒ tiêu chí không có dòng thì **ĐỎ**.

**Test KHÔNG canh được** việc dòng bảng có thật sự phủ tiêu chí hay không: đã thử ràng
buộc bằng cách so cụm từ dẫn nhập và nó **bắt oan** một plan hợp lệ (tiêu chí "Màn
hình" ↔ dòng bảng nói "Transcript … cùng block"). ⇒ Văn xuôi trong bảng vẫn phải được
**đọc** (bởi agent và reviewer). Đừng hứa quá thứ test canh.

Câu `**Người dùng thấy:**` viết **trước** khi code: đó là thứ duy nhất tự đặt ra ranh
giới quan sát mà tác giả plan không nghĩ tới.

### Luật 2 — Kỳ vọng lấy từ YÊU CẦU, không lấy từ code

Số/giá trị trong kỳ vọng phải suy ra từ yêu cầu — **không** từ "tôi vừa viết ra gì".
Đo 2026-10-20: `expect(r.messages.length).toBe(2)` — con số 2 đếm từ code ⇒ test xanh
vì code đúng như tôi viết, không phải vì hành vi đúng. Dấu hiệu: đổi implementation
(thêm/bớt một message) thì kỳ vọng phải **đổi theo**.

### Luật 3 — Mỗi feature có ≥ 1 test kịch bản end-to-end

Ở ranh giới **quan sát được**: file trên đĩa, output thật, exit code. Test tầng hàm
không bắt được lỗi tầng hệ thống — đó chính là Critical của lượt 6.

### Luật 4 — Review độc lập là BẮT BUỘC trước khi push

Skill `requesting-code-review`. Đo 2026-10-20: lượt implement đường giả lập đã **push
4 commit** mà không gọi review — và reviewer sau đó bắt đúng Critical đó. "Tự đọc lại
diff của mình" **không thay thế** được: tự review là hỏng theo cấu trúc (đọc lại *ý
định*, không phải *hành vi*). Reviewer phải được yêu cầu **chạy probe end-to-end**,
không chỉ đọc diff.

### Lý do thường để bỏ qua (đo được)

| Lời giải thích | Thực tế |
|---|---|
| "Tôi đã có `Review Focus` rồi" | Focus là văn xuôi; **Task** mới là thứ được kiểm ⇒ Focus sai mà không ai báo |
| "Test xanh rồi mà" | Xanh vì kỳ vọng lấy từ code (Luật 2) |
| "Mutation bắt được rồi" | Mutation bắt được thứ test **đã khẳng định**; **không** bắt được hành vi **còn thiếu** |
| "Reviewer sẽ bắt" | Không có reviewer thì không ai bắt — lượt 5 đã tự push không review |

**Luật 2/3/4 là quy tắc cho agent, KHÔNG có test canh** (test chỉ canh Luật 1). Đừng đòi
test cho chúng — nhưng cũng đừng coi là "không cần làm".

## 3. Sửa token màu phải sửa cả ba file

`tests/design-system.test.ts` canh chiều hai chiều giữa test, `tailwind.config.ts` và
`app/globals.css` — sửa một bên thì test đỏ. Sửa đồng thời cả ba trong một lượt.
`brand-lime`/`brand-mid`/`brand-deep` là `token('--brand-…')`; `brand` là **hex viết
thẳng**, không có biến `--brand` trong `globals.css`.

## 4. Tài liệu

**Tài liệu không có hiệu lực. Test mới có.** ⇒ Cùng nguyên tắc này áp cho **KẾ HOẠCH**
(mục 2.5): `## Review Focus` viết bằng văn xuôi không có hiệu lực; chỉ bảng "tiêu chí →
test" mới có.

- `DESIGN.md` — định hướng ngắn, không phải hợp đồng.
- `PLAN.md` — **còn sống**: code và test trỏ tới các mục của nó (`PLAN.md §17`,
  `PLAN.md 10.6`) ⇒ đừng xoá, và đừng sửa mục đó mà không cập nhật chỗ trỏ.
- Bản `DESIGN.md` cũ (1410 dòng) + file audit-UI + các plan/ledger đã xong —
  **đã XOÁ 2026-10-20** (lịch sử nằm trong git). Đừng tạo lại; đừng trỏ tới.

`npm run docs:check` dùng `git ls-files` ⇒ **file mới phải `git add` trước** thì nó mới
được theo dõi.

## 5. Ngôn ngữ

| Chỗ | Dấu tiếng Việt |
|---|---|
| Comment trong code, tài liệu | **CÓ** |
| Tin nhắn commit | **KHÔNG** (`fix(agents): sua Critical cua reviewer`) |

Commit theo `type(scope): mô tả`, scope là vùng code (`agents`, `brand`, `ui`…).

## 6. Code chết thì xoá hẳn

*"Cái nào không cần thì xoá hết, không giữ lại"*. Đừng giữ lại vì "có thể sau này cần",
và đừng refactor code không liên quan. Xoá thì xoá **sạch trong code** — lý do để ở
commit message hoặc ledger, đừng để lại comment "bia mộ" trong file nguồn. Chỉ giữ
comment ở chỗ mà người sau rất dễ vô tình viết lại (bẫy kiến trúc).

**Trước khi viết cái mới: dùng lại cái đang có.** Viết thêm cơ chế thứ hai cho một việc
đã có cơ chế là **chắt vá**. Trước khi tạo file/hằng/hàm mới, trả lời bằng grep: việc này
đã có ai làm chưa? Nếu có — **mở rộng nó**, đừng viết song song.

**Trước khi xoá: tìm không ra KHÔNG phải bằng chứng.** Bốn điều phải làm:

1. Thử lệnh tìm trên một thứ **chắc chắn còn sống** và xác nhận nó tìm thấy.
2. Không tin kết quả rỗng khi lệnh vừa in lỗi (regex sai làm `Select-String` ném lỗi
   *cho từng file* rồi trả kết quả rỗng với exit 0).
3. Dùng công cụ recurse thật: `rg`, tool `grep`, `Get-ChildItem -Recurse`.
   `**` trong PowerShell không luôn đệ quy.
4. Quét cả cây, không chỉ thư mục code — ký hiệu còn sống có thể nằm trong `tests/`,
   fixture, file cấu hình, hoặc chỉ xuất hiện dưới dạng *chuỗi*.

## 7. Đơn vị và định danh phải khớp

### 7.1. Đơn vị giữa schema và backend phải khớp

Đổi tên tham số **không** đổi được đơn vị. Khác đơn vị thì phải **chuyển đổi**, và
chuyển đổi phải **theo từng tool** chứ không phải theo tên tham số. Trước khi tin một
tên tham số đã "khớp", mở schema **và** schema của backend ra đặt cạnh nhau, đọc
**min/max và đơn vị** của cả hai.

### 7.2. Đừng dùng chuỗi người dùng (hoặc model) làm khoá

```
đọc "a.txt" → ghi "./a.txt" ⇒ KHÔNG bị chặn ✘   (cùng một file!)
đọc "a.txt" → ghi "A.TXT"   ⇒ KHÔNG bị chặn ✘   (Windows không phân biệt hoa/thường)
```

Luật: **khoá theo dạng đã chuẩn hoá** (`path.resolve` + hạ chữ hoa trên hệ điều hành
không phân biệt), không theo chuỗi người dùng gõ. Cùng luật cho mọi thứ dùng làm khoá:
id phiên, tên file, khoá cấu hình.

### 7.3. Đổi hợp đồng thì grep mọi caller

Đổi **signature**, kiểu trả về, hay hành vi của một hàm — code *gọi* nó có thể vỡ ở chỗ
không nằm trong diff. Trước khi sửa, **grep mọi caller** trên toàn cây. Sửa ở **chỗ
dùng chung, một lần** — đừng vá lặp ở từng caller để "cho xong".

## 8. Kiểm byte khi sửa file — BOM và thay đổi vô nghĩa

- File nguồn **không được có BOM** (`tests/repo-hygiene.test.ts` canh).
- Sau khi sửa hàng loạt file, đọc `git diff --stat` và xem có dòng nào đổi cả file mà
  không đổi nội dung không.
- Ký tự đặc biệt trong lệnh sửa file là nguồn lỗi âm thầm: backtick (`` ` ``) thay vì
  nháy đơn (`'`) làm **parse error**, còn `'` trong PowerShell `.Replace()` với chuỗi
  tiếng Việt lại **không khớp và không báo lỗi**.

## 9. Bản đồ nhanh

| Việc | Ở đâu |
|---|---|
| Tool runtime của agent | `core/agent-runtime/` |
| Hook điều phối chat | `react/use-chat-orchestration.ts` |
| Multi-tab lock | `core/agent-runtime/tab-lock.ts` |
| Hình + màu logo | `brand/mark.json` → `components/vyen-logo.tsx` + `scripts/build-icons.cjs` |
| Bảng màu giao diện | `app/globals.css` + `tailwind.config.ts` + `tests/design-system.test.ts` |
| Vị trí logo được phép hiện | `tests/brand-placement.test.ts` |
| **CLI — điểm vào** | `cli/index.ts` (REPL, `-p` cho một lượt) |
| **CLI — vòng lặp tool** | `cli/agent-turn.ts` + `cli/repl.ts` (`/exit`, `/new`) |
| **CLI — lượt giả lập** | `cli/emulated.ts` (model không hỗ trợ function calling) |
| **CLI — lưu hội thoại** | `cli/session.ts` (JSONL append-only) |
| **CLI — cổng duyệt** | `cli/approve.ts` (mặc định KHÔNG) + `cli/terminal.ts` |
| **CLI — system prompt** | `cli/instructions.ts` (nạp `AGENTS.md`, cắt ở 20.000 ký tự) |
| **CLI — cầu nối tool** | `lib/tools/ipc-node.ts` (cầu `lib/ipc.cjs`) |
| **CLI — bảng kiểm kê** | `docs/cli-migration-inventory.md` + `scripts/cli-migration/` |
| Cổng chống hạ chuẩn (mục 1.1) | `tests/repo-hygiene.test.ts` |
| **CLI — TUI (màn hình đồ họa)** | `cli/tui/` (đảo ESM: có `package.json` riêng) + `cli/tui-gate.ts` + `cli/approval-broker.ts`. Tắt bằng `VYEN_PLAIN=1`; cần Node ≥ 26.4.0 (OpenTUI cần FFI) |

## 10. Trước khi báo xong

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test` — không đỏ (trừ 4 flaky ở mục 1)
- [ ] `npm run lint` — không có lỗi mới
- [ ] `npm run docs:check` OK
- [ ] `npm run build` exit 0
- [ ] Test mới đã được chứng minh ĐỎ (mục 2)
- [ ] **Mutation đã được xác nhận là thật sự thay đổi hành vi** (mục 2.2)
- [ ] **Mọi lời hứa trong comment mới đều có test đỏ khi bỏ lớp bảo vệ** (mục 2.1)
- [ ] **Kỳ vọng lấy từ yêu cầu, không lấy từ code** (mục 2.5 — Luật 2, *tự khai*)
- [ ] **Có ≥ 1 test kịch bản end-to-end** ở ranh giới quan sát được (mục 2.5 — Luật 3, *tự khai*)
- [ ] **Đã gọi skill `requesting-code-review` trước khi push** (mục 2.5 — Luật 4, *tự khai*)
- [ ] Plan có mục `## Kịch bản & Test`; mọi tiêu chí trong `Review Focus` đều có dòng (mục 2.5 — Luật 1, *có test canh*)
- [ ] File mới đã `git add`
- [ ] File nguồn không có BOM (mục 8)
>>>>>>> c3edcb8 (docs(cli): cap nhat ban do va huong dan tui)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
