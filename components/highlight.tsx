'use client';

import React, { memo } from 'react';
import type { SnippetSegment } from '@/lib/search-utils';

export const Highlight = memo(function Highlight({
  segments,
}: {
  segments: SnippetSegment[];
}) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded-sm bg-accent-soft px-0.5 text-accent"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  );
});
