/**
 * Sarsed-Code Architecture Types.
 * Conforms to sarsvankelsion/sarsed-code specification.
 *
 * Core Capabilities:
 * 1. AST Code Skeletonization (80-90% token reduction for prompt context).
 * 2. Multi-Language Symbol Indexing & Call Hierarchy.
 * 3. Transactional Multi-Hunk Semantic Patching with Indentation Normalization.
 * 4. Structured Diagnostic Parsing (tsc, eslint, vitest, python, rust).
 * 5. Autonomous SARS (Sense-Analyze-Refactor-Synthesize) Self-Correction Loop.
 * 6. Multi-Role Fleet (Architect, Coder, Verifier, Critic).
 */

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'method'
  | 'enum'
  | 'module';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  col: number;
  exported: boolean;
  signature?: string;
  docstring?: string;
}

export interface FileSkeleton {
  file: string;
  language: string;
  symbols: CodeSymbol[];
  imports: string[];
  exports: string[];
  totalLines: number;
  skeletonLines: number;
  reductionPercentage: number;
  skeletonText: string;
}

export interface SemanticHunk {
  search: string;
  replace: string;
  lineHint?: number;
  contextBefore?: string;
  contextAfter?: string;
  fuzzyTolerance?: number; // 0.0 (exact) to 0.3 (tolerant)
}

export interface SemanticPatch {
  file: string;
  hunks: SemanticHunk[];
  /** If true, all hunks must succeed or none is applied (atomic rollback) */
  atomic: boolean;
}

export interface HunkApplyResult {
  hunkIndex: number;
  applied: boolean;
  matchedLine?: number;
  error?: string;
}

export interface PatchResult {
  success: boolean;
  file: string;
  hunksApplied: number;
  totalHunks: number;
  hunkResults: HunkApplyResult[];
  error?: string;
  originalContent?: string;
  modifiedContent?: string;
  diff?: string;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  code?: string;
  message: string;
  source: 'tsc' | 'eslint' | 'vitest' | 'compiler' | 'runtime';
  rawSnippet?: string;
}

export interface VerificationResult {
  ok: boolean;
  command: string;
  exitCode: number;
  diagnostics: CodeDiagnostic[];
  errorCount: number;
  warningCount: number;
  output: string;
  durationMs: number;
}
