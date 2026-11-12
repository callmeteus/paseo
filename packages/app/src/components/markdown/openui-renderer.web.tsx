import { useCallback, useState, type ReactNode } from "react";
import { Renderer, defineComponent } from "@openuidev/react-lang";
import {
  InlineMarkdownRenderer,
  openuiLibrary,
  ScrollableTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openuidev/react-ui";
import type { ActionEvent } from "@openuidev/lang-core";
import { z } from "zod/v4";
import "@openuidev/react-ui/styles/index.css";

const TABLE_PAGE_SIZE = 10;

const paginationStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "8px",
  paddingTop: "8px",
} as const;

const pageLabelStyle = { fontSize: "13px", color: "#6b7280" } as const;

const ColSchema = z.object({
  label: z.string(),
  data: z.any(),
  type: z.enum(["string", "number", "action"]).optional(),
});

/** Same Col contract as the built-in library. */
const MarkdownTableCol = defineComponent({
  name: "Col",
  props: ColSchema,
  description: "Column definition — holds label + data array",
  component: () => null,
});

interface TableColumnDefinition {
  label: string;
  data: unknown[];
}

interface MarkdownTableComponentProps {
  props: { columns?: unknown[] };
  renderNode: (value: unknown) => ReactNode;
}

/**
 * The stock Table renders string cells verbatim, so inline `code` in a cell
 * shows its backticks. Render string cells through the inline markdown
 * renderer so backticks format like everywhere else.
 */
function MarkdownTableComponent({ props, renderNode }: MarkdownTableComponentProps) {
  const [page, setPage] = useState(0);

  const colDefs: TableColumnDefinition[] = (props.columns ?? []).flatMap((column) => {
    const record = column as { props?: { label?: string; data?: unknown } } | null;
    if (!record?.props) return [];
    return [
      {
        label: record.props.label ?? "",
        data: Array.isArray(record.props.data) ? record.props.data : [],
      },
    ];
  });

  const goPrevious = useCallback(() => {
    setPage((current) => Math.max(0, current - 1));
  }, []);

  const totalPages =
    colDefs.length > 0
      ? Math.ceil(Math.max(...colDefs.map((c) => c.data.length)) / TABLE_PAGE_SIZE)
      : 0;
  const goNext = useCallback(() => {
    setPage((current) => Math.min(totalPages - 1, current + 1));
  }, [totalPages]);

  if (!colDefs.length) return null;

  const rowCount = Math.max(...colDefs.map((column) => column.data.length), 0);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const startRow = safePage * TABLE_PAGE_SIZE;
  const endRow = Math.min(startRow + TABLE_PAGE_SIZE, rowCount);

  return (
    <div>
      <ScrollableTable>
        <TableHeader>
          <TableRow>
            {colDefs.map((column) => (
              <TableHead key={`head-${column.label}`}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: endRow - startRow }, (_, index) => {
            const rowIndex = startRow + index;
            return (
              <TableRow key={`row-${rowIndex}`}>
                {colDefs.map((column) => {
                  const cell = column.data[rowIndex];
                  return (
                    <TableCell key={`cell-${column.label}-${rowIndex}`}>
                      {typeof cell === "object" && cell !== null ? (
                        renderNode(cell)
                      ) : (
                        <InlineMarkdownRenderer content={String(cell ?? "")} />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </ScrollableTable>
      {totalPages > 1 ? (
        <div style={paginationStyle}>
          <button
            type="button"
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={goPrevious}
          >
            ‹
          </button>
          <span style={pageLabelStyle}>
            {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={safePage >= totalPages - 1}
            onClick={goNext}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

const MarkdownTable = defineComponent({
  name: "Table",
  props: z.object({ columns: z.array(MarkdownTableCol.ref) }),
  description: "Data table — column-oriented. Each Col holds its own data array.",
  component: MarkdownTableComponent,
});

const openuiLibraryWithMarkdownTables = openuiLibrary.extend({
  components: { override: [MarkdownTableCol, MarkdownTable] },
});

export interface OpenUIRendererProps {
  code: string;
  streaming?: boolean;
  /** Send a conversational button action back to the agent. */
  onAction?: (message: string) => void;
}

/** Renders an assistant message written in OpenUI Lang with the official renderer. */
export function OpenUIRenderer({ code, streaming = false, onAction }: OpenUIRendererProps) {
  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === "open_url") {
        const url = typeof event.params?.url === "string" ? event.params.url : null;
        if (url && typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      const message = event.humanFriendlyMessage?.trim();
      if (message) onAction?.(message);
    },
    [onAction],
  );

  return (
    <Renderer
      response={code}
      library={openuiLibraryWithMarkdownTables}
      isStreaming={streaming}
      onAction={handleAction}
    />
  );
}
