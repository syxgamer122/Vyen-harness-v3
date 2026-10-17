# Spec: Agent khai báo cho Vyen (Declarative Agent Definitions)

- Ngày: 2026-10-17
- Phạm vi: Spec #1 trong 2. Không bao gồm spawn tách rời (Spec #2).
- Trạng thái: chờ review

---

## 1. Vấn đề

`delegate` hiện tại (`lib/agent-tools.ts:1227`) là một lời gọi hàm blocking không có danh tính:

- Parent phải tự viết `instructions` dài 10–5000 ký tự **mọi lần gọi**, từ đầu.
- Không có danh sách agent để model đọc và tự chọn. Model phải *soạn brief* thay vì *chọn người*.
- `mode: 'scout' | 'worker'` chỉ là hai hằng số viết cứng trong schema.
- `subagent.ts:9-10` nói rõ chống đệ quy bằng **chữ trong prompt**: *"subagent CANNOT call delegate (enforced by excluding 'delegate' from its tool set)"* — cơ chế đúng nhưng thuộc về `runSubagent`, không phải về định nghĩa agent.
- `defaultSubagentScope` (`subagent.ts`) nhốt ghi vào `tests/**`, `scratch/**`, `tmp/**` — thuộc tính năng bị giấu trong code, không ai nhìn thấy khi viết agent.

Hệ quả: mỗi lần delegate đều là một lần thiết kế brief từ số 0, và không có cách nào khai báo "con này chỉ đọc" ngoài việc nhớ tên hằng `scout`.

**Cảm giác "như lon" của sub-agent Vyen bắt nguồn từ đây, không phải từ việc nó chạy in-process.**

## 2. Mục tiêu

Cho phép khai báo agent bằng file, để model tự chọn theo mô tả, và để agent **không có trong schema** các tool nó không được phép dùng.

Tiêu chí thành công:
1. Model đọc danh sách `name` + `description` và chọn đúng agent mà không cần viết prose dài.
2. Agent chỉ-đọc **không thể** gọi tool ghi — không phải "gọi thì bị chặn", mà là không có trong schema.
3. Không sinh ra code chết mới. Code chết có sẵn bị dọn.
4. `delegate` vẫn blocking (giữ nguyên cơ chế chạy hiện tại). Spec #2 mới tách rời.

Ngoài phạm vi: spawn tách rời, `send_message`, `interrupt`, giám sát, bền vững qua restart. Đó là Spec #2.

## 3. Hướng tham khảo

| Nguồn | Lấy gì |
|---|---|
| Claude Code, OpenCode | Định dạng agent markdown + frontmatter; tool scoping bằng cách lọc schema |
| dsh (DeepSeek Harness, MIT) | Thứ tự phân giải tên: cụ thể > wildcard > mặc định; `ToolRestriction` chỉ theo tên tool, không glob |
| Orca | Không lấy gì. Nửa "tiến trình + worktree" là thiết kế cho IDE, không phải harness nhẹ |

## 4. Định dạng định nghĩa agent

File: `.vyen/agents/<name>.md`. Tên file **là** tên agent (không khai báo `name` trong frontmatter — không có chỗ cho file và tên lệch nhau).

```markdown
---
description: Review code for correctness, security và hiệu năng. Chỉ đọc.
tools: [fs_read, fs_list, fs_search, web_fetch]
model: fast
steps: 12
---

Bạn đang review code. Báo cáo phát hiện, không bao giờ sửa.
```

### Frontmatter

| Trường | Bắt buộc | Kiểu | Mặc định |
|---|---|---|---|
| `description` | có | string, ≤ 400 ký tự | — |
| `tools` | không | string[] tên tool | kế thừa bộ tool của cha |
| `model` | không | `inherit` \| `fast` \| `<model id>` | `inherit` |
| `steps` | không | số nguyên 1–25 | 10 |

Cố ý **không** có: `mode` (primary/subagent), `permission`, `hidden`, `color`, `temperature`.
Agent trong `.vyen/agents/` đều là agent con. Các tuỳ chọn còn lại thuộc Spec #2 hoặc thuộc cấu hình model hiện có.

`description` là **thứ duy nhất model đọc** để quyết định. Nó phải trả lời "làm được gì" và "khi nào nên gọi", không phải "tôi là ai".

### Phân giải tên

```
1. Khớp chính xác tên file      "code-reviewer"
2. Wildcard                    "reviewer-*", "*-scout"   — nhiều ký tự nhất thắng
3. Không có                    → tool trả lỗi, liệt kê tên hợp lệ
```

Không có agent mặc định ẩn. `delegate` với `agent` bị bỏ trống dùng bộ tool đầy đủ (hành vi như hôm nay). Tên không tồn tại → **báo lỗi liệt kê tên hợp lệ**, không im lặng fallback.

Lý do không dùng "khai báo sau thắng" như OpenCode: thứ tự file là thứ tự vô tình, người dùng thêm file mới sẽ vô tình đổi hành vi agent cũ.

## 5. Lọc tool — phần quan trọng nhất

Agent con nhận tool = **giao của bộ tool cha và `tools` khai báo** (khi có khai báo). `delegate` luôn bị loại khỏi bộ tool con.

Điểm mấu chốt: `delegate` của agent con **không có `execute` và không xuất hiện trong schema**. Model không thể gọi thứ nó không nhìn thấy. Đây là sự thay thế trực tiếp cho việc dựa vào câu `"NO Delegation"` trong prompt.

`clientToolNames` đã là seam sẵn có (`runSubagent` nhận nó, `subagent.ts` đang lọc `SCOUT_DENIED_CLIENT_TOOLS` theo danh sách tên). Spec này thay denylist đó bằng allowlist theo agent.

### Quyết định về CapBAC

`defaultSubagentScope` (`writePatterns: ['tests/**','scratch/**','tmp/**']`) bị **xoá**.

Lý do: allowlist trong file agent là bề mặt quyền **do người dùng viết và nhìn thấy**. Nhốt ghi vào `tests/scratch/tmp` trong code làm cho khai báo `tools: [fs_read, fs_write]` thành dối trá — file nói con được ghi, runtime thì không cho ghi chỗ khác.

Hệ quả an toàn còn lại: **mọi tool call của agent con vẫn đi qua cổng duyệt của user** (`lib/auto-pilot.ts`).

Đã xác minh đường đi này: renderer nhận annotation `subagentCall` (`use-chat-orchestration.ts:3331`) rồi gọi `handleClientToolCall` — **đúng executor với tool thường** (dòng 3355) — nên các case `shell_run` / `run_code` vẫn chạy qua `autoApproveShell` / `autoApproveCode`, tức `shouldAutoApprove` (dòng 1143, 1254, 1294). Hàng đợi duyệt của user không bị bỏ qua vì tool đến từ subagent.

Điểm chặn thật nằm ở tầng cấu hình của user, không phải tầng hằng số trong code. Đây là điểm chặn tốt hơn, nhưng **rộng hơn**: agent con được ghi ra ngoài `tests/**`.

Một giới hạn đã biết, không do spec này gây ra: relay chỉ chạy khi `isLoading` còn đúng (dòng 3327). Agent con chỉ dùng được client tool **trong lúc stream của cha còn mở**. `delegate` vẫn blocking nên điều này đúng; Spec #2 tách rời sẽ phải xử lý.

## 6. `delegate` mới

Thay toàn bộ schema hiện tại. Giữ nguyên cơ chế blocking.

```
delegate({
  agent?:   string,      // tên file trong .vyen/agents/, hoặc wildcard. Bỏ trống = bộ tool đầy đủ
  task:     string,      // 10–5000 ký tự. Việc cần làm, không phải bản tóm tắt agent
  steps?:   number,      // 1–25, ghi đè `steps` của agent
  model?:   string,      // ghi đè model
  context?: 'fresh'|'brief'
})
```

Bỏ: `instructions`, `tasks[]`, `mode`, `max_turns`, `timeout_secs`.

- `tasks[]` (fan-out 4 task / 3 song song) → thuộc Spec #2, khi spawn đã tách rời.
- `mode: scout|worker` → thay bằng `tools:` trong file agent.
- `max_turns` → thay bằng `steps` trong file agent.

Giữ `timeout_secs` ở tầng runtime (không nằm trong schema) vì delegate vẫn blocking; giá trị mặc định lấy từ `SUBAGENT_DEFAULT_TIMEOUT_SECS`. Đưa vào schema khi nào Spec #2 tách rời.

`context: 'brief'` giữ nguyên — `buildSubagentParentBrief` đã có và hoạt động.

## 7. Mô tả mới cho `delegate`

Bản hiện tại dài 7 dòng và mô tả cơ chế (`Max turns mặc định 10`, `1-4 task`, `mode scout/worker`) thay vì nói lựa chọn. Thay bằng:

```
GIAO VIỆC cho subagent chạy context RIÊNG (không thấy lịch sử chat này).

Agent có sẵn:
  code-reviewer — Review code về correctness, security, hiệu năng. Chỉ đọc.
  explorer      — Tìm file theo pattern, grep từ khoá, đọc code. Chỉ đọc.

Chọn `agent` theo việc cần làm, rồi viết `task` cụ thể cho nó.
Agent chỉ có đúng các tool trong khai báo của nó — ví dụ code-reviewer không
có fs_write, nên đừng bảo nó sửa code.
```

Danh sách được sinh từ registry tại runtime, nên luôn khớp với file trên đĩa.

## 8. Code chết phải dọn

Đã xác minh bằng grep, không phải suy đoán:

| File | Ai dùng thật | Hành động |
|---|---|---|
| `core/agent-runtime/state-machine.ts` | chỉ `tests/core-state-machine.test.ts` | xoá cả hai |
| `core/agent-runtime/fencing.ts` | chỉ `tests/storage-fencing.test.ts` | xoá cả hai |
| `core/agent-runtime/tool-runner.ts` | chỉ còn `validateShellAllowlist` (60 dòng; phần engine ~900 dòng đã bị xoá từ trước) | chuyển hàm đó sang `lib/shell-policy.ts`, xoá file |
| `tests/core-state-machine.test.ts` | giữ `validateShellAllowlist` case | cắt còn case đó |
| `SCOUT_DENIED_CLIENT_TOOLS` | `subagent.ts` | xoá, thay bằng allowlist theo agent |
| `defaultSubagentScope` | `subagent.ts` | xoá (mục 5) |
| `withSubagentWriteScope` | `subagent.ts` | xoá (mục 5) |
| `core/agent-runtime/capability-context.ts` | `lib/subagent.ts` + `tests/subagent-write-scope.test.ts` + `tests/capability-projection.test.ts` | xoá cả file và test |

Lưu ý về dòng cuối: đây là hệ quả trực tiếp của mục 5, không phải việc dọn có sẵn. `validateSubagentPermission` và `createCapabilityScope` chỉ tồn tại để phục vụ CapBAC; bỏ CapBAC thì chúng không còn đường nào gọi tới. Đã grep xác minh: không nơi nào khác import chúng.

Giữ nguyên: `tab-lock.ts`, `runtime-actor.ts`, `actor-registry.ts`, `types.ts` — chúng nằm trên đường chạy qua `react/use-agent-runtime.ts` (`use-chat-orchestration.ts:6405`).

## 9. Thành phần mới

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `lib/agents/agent-definition.ts` | Kiểu `AgentDefinition` + phân tích frontmatter | không |
| `lib/agents/agent-registry.ts` | Quét `.vyen/agents/`, phân giải tên, `describeAgents()` | `agent-definition.ts` |
| `lib/agents/agent-tool-scope.ts` | `resolveAgentToolNames(parent, def)` | `tool-catalog.ts` |

Mỗi file một việc, test được độc lập, không import vòng.

## 10. Luồng dữ liệu

```
.bản chuẩn bị: đọc .vyen/agents/*.md → AgentDefinition[]

yêu cầu cha:
  server ghép tool cho cha
    └─ delegate description <- registry.describeAgents()      [danh sách tên]
  model gọi delegate({agent:'code-reviewer', task:'...'})
    └─ registry.resolve('code-reviewer')
         ├─ không có → lỗi + liệt kê tên hợp lệ
         └─ có → AgentDefinition
              └─ resolveAgentToolNames(bộToolCha, def.tools)
                   └─ runSubagent({ clientToolNames: <đã lọc>, steps, model })
                        └─ execute trả về chuỗi kết quả (như hôm nay)
```

## 11. Lỗi

| Tình huống | Hành vi |
|---|---|
| `agent` không tồn tại | tool trả `{error, available:[...]}` — model tự sửa |
| File frontmatter sai | registry bỏ qua file, ghi 1 dòng cảnh báo, các agent khác vẫn chạy |
| `tools` chứa tên không có trong catalog | cảnh báo, bỏ tên đó, không chặn phần còn lại |
| `steps` ngoài 1–25 | kẹp về [1,25] |
| Không có `.vyen/agents/` | `delegate` vẫn hoạt động như hôm nay (bộ tool đầy đủ) |

Không trường hợp nào trong bảng này làm hỏng lượt chat hiện tại.

## 12. Kiểm thử

| Test | Kiểm chứng |
|---|---|
| `agent-definition.test.ts` | frontmatter hợp lệ/lỗi; `steps` kẹp đúng |
| `agent-registry.test.ts` | chính xác > wildcard > lỗi; nhiều file; file hỏng không chặn file khác |
| `agent-tool-scope.test.ts` | giao đúng; `delegate` luôn bị loại; agent khai báo rỗng = không có tool |
| `agent-catalog-projection.test.ts` | mô tả `delegate` khớp file trên đĩa |
| `subagent.test.ts` (sửa) | bỏ case scout/worker; thêm case lọc theo agent |
| — | `tests/subagent-write-scope.test.ts` và `tests/capability-projection.test.ts` bị xoá cùng CapBAC; case tương đương được viết lại trong `agent-tool-scope.test.ts` |

Test hành vi đầu-cuối: một agent chỉ-đọc được gọi với `fs_write` trong tham số → phải không thấy `fs_write` trong bộ tool, và không có `execute` nào nhận lời gọi đó.

## 13. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Xoá CapBAC làm rộng quyền ghi của agent con | cổng duyệt của user vẫn chạy (mục 5, đã xác minh); nêu rõ trong review |
| Model gọi tên agent không có | lỗi liệt kê tên hợp lệ, model tự sửa trong lượt đó |
| `tools` khai báo thiếu tool mà body của agent cần | người viết agent tự chịu trách nhiệm — đây là điểm đánh đổi có chủ ý |
| `describeAgents()` phình prompt | `description` trần 400 ký tự, chỉ ghép tên + mô tả. Không ghép phần `tools` vào |

## 14. Sau Spec #1

Đã biết, chưa làm: spawn tách rời trả `childId`, `send_message`, `interrupt`, `wait`; giám sát vòng đời; liveness ba giá trị; persist qua restart; fan-out `tasks[]`. Spec #2 dựa trên nền này.
