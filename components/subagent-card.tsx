"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { EvidenceBadge } from "@/components/evidence-badge";

export interface SubagentAnnotation {
  subagent: {
    phase: "start" | "progress" | "done" | "error";
    task?: string;
    turn?: number;
    maxTurns?: number;
    toolCalls?: number;
    result?: string;
    error?: string;
    /** Metadata mới từ executeDelegate — batch song song gắn nhãn lane. */
    runId?: string;
    mode?: "scout" | "worker";
    taskIndex?: number;
    taskTotal?: number;
    evidenceLevel?: "prepared" | "running" | "reported_done" | "verified" | "blocked" | "failed";
  };
}

interface SubagentCardProps {
  annotation: SubagentAnnotation;
}

export function SubagentCard({ annotation }: SubagentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { phase, task, turn, maxTurns, toolCalls, result, error, runId, mode, taskIndex, taskTotal, evidenceLevel } =
    annotation.subagent;

  const isRunning = phase === "start" || phase === "progress";
  const isDone = phase === "done";
  const isError = phase === "error";

  const subagentEvidence = evidenceLevel ?? (
    isRunning
      ? "running"
      : isDone
        ? (result?.toLowerCase().includes("verified") || result?.toLowerCase().includes("test pass") ? "verified" : "reported_done")
        : "failed"
  );

  const statusColor = isRunning
    ? "text-accent-steel"
    : isDone
      ? "text-status-success"
      : "text-status-error";

  /*
   * VẠCH TRẠNG THÁI, y hệt `ToolChip` (tool-trace.tsx): màu vạch + chữ trạng
   * thái ở đuôi dòng. Trước đây thẻ là một khối `rounded-xl` viền + nền riêng
   * — vật thể to nhất và nổi nhất trong cả bảng kê công việc, đúng cái "mọi
   * thứ đều là thẻ" mà §13.1 cảnh báo. Nay nó là MỘT dòng trong cùng cột
   * 34px, cùng kiểu vạch, nên đọc như một mắt xích của trace chứ không phải
   * một cái hộp rời.
   *
   * Trạng thái vẫn nằm ở CHỮ (`EvidenceBadge` + nhãn ở đuôi) chứ không chỉ ở
   * màu vạch — §6: ý nghĩa không được chỉ dựa vào màu. Ba nhánh viết thẳng
   * trong className (giống `ToolChip`) vì assertion viền-cần-màu của
   * `tests/design-system.test.ts` không nội dung dung được class gắn qua biến.
   */
  const railClass = isRunning
    ? "rounded-lg border-l-2 border-l-accent pl-2 text-secondary"
    : isDone
      ? "rounded-lg border-l-2 border-l-subtle pl-2 text-tertiary"
      : "rounded-lg border-l-2 border-l-danger pl-2 text-danger";
  const statusText = isRunning ? "đang chạy" : isDone ? "xong" : "lỗi";

  // Một icon duy nhất mang trạng thái thật (spin = đang chạy)
  const StatusIcon = isRunning ? Loader2 : isDone ? CheckCircle2 : XCircle;

  return (
    <div className={`my-1 ${railClass} font-sans text-meta`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-sunken"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        )}
        <StatusIcon
          className={`h-3.5 w-3.5 flex-shrink-0 ${statusColor} ${
            isRunning ? "animate-spin" : ""
          }`}
        />
        <span className="font-medium text-secondary">Subagent</span>
        <EvidenceBadge level={subagentEvidence} />
        {mode === "scout" && (
          <span className="text-meta text-text-muted">· khảo sát</span>
        )}
        {taskIndex != null && taskTotal != null && (
          <span className="text-meta text-text-muted">
            {taskIndex + 1}/{taskTotal}
          </span>
        )}
        {runId && (
          <span className="text-meta text-text-muted">#{runId.slice(0, 6)}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-meta text-text-muted">
          <span>
            {turn != null && maxTurns != null && `${turn}/${maxTurns} lượt`}
            {toolCalls != null && ` · ${toolCalls} công cụ`}
          </span>
          <span>{statusText}</span>
        </span>
      </button>

      {expanded && (
        <div className="mt-1 space-y-1.5 border-t border-subtle px-2 pt-2">
          {task && (
            <p className="text-meta text-text-primary">
              <span className="font-semibold text-accent-steel">Nhiệm vụ:</span> {task}
            </p>
          )}
          {result && (
            <p className="text-meta whitespace-pre-wrap text-text-muted">
              <span className="font-semibold text-status-success">Kết quả:</span> {result}
            </p>
          )}
          {error && (
            <p className="text-meta text-status-error">
              <span className="font-semibold">Lỗi:</span> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Extract subagent annotations from a message's annotations array.
 */
export function getSubagentAnnotations(
  annotations: unknown[] | undefined,
): SubagentAnnotation[] {
  if (!annotations) return [];
  return annotations.filter(
    (ann): ann is SubagentAnnotation =>
      typeof ann === "object" &&
      ann !== null &&
      "subagent" in ann &&
      typeof (ann as Record<string, unknown>).subagent === "object",
  );
}
