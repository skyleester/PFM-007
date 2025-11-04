import React from "react";
import type { AccountKind } from "./MetadataForm";

export type AccountV2 = {
  id: number;
  name: string;
  type: AccountKind;
  provider?: string | null;
  parent_id?: number | null;
  is_active: boolean;
  extra_metadata: Record<string, any>;
};

export type AccountV2TreeNode = AccountV2 & { children: AccountV2TreeNode[] };

export type AccountTreeProps = {
  nodes: AccountV2TreeNode[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  collapsed: Record<number, boolean>;
  onToggle: (id: number) => void;
  onReparent?: (draggedId: number, newParentId: number | null) => void;
};

function badgeColor(kind: AccountKind) {
  switch (kind) {
    case "BANK":
      return "bg-emerald-100 text-emerald-800";
    case "CARD":
      return "bg-indigo-100 text-indigo-800";
    case "POINT":
      return "bg-amber-100 text-amber-900";
    case "STOCK":
      return "bg-blue-100 text-blue-800";
    case "PENSION":
      return "bg-teal-100 text-teal-800";
    case "LOAN":
      return "bg-rose-100 text-rose-800";
    case "CASH":
      return "bg-gray-200 text-gray-800";
    case "VIRTUAL":
      return "bg-slate-200 text-slate-800";
  }
}

export function AccountTree({ nodes, selectedId, onSelect, collapsed, onToggle, onReparent }: AccountTreeProps) {
  const handleDropToRoot: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const draggedIdStr = e.dataTransfer.getData("text/account-id");
    const draggedId = Number(draggedIdStr);
    if (!Number.isFinite(draggedId)) return;
    onReparent?.(draggedId, null);
  };

  const allowDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (e.dataTransfer.types.includes("text/account-id")) {
      e.preventDefault();
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="rounded-md border border-dashed border-gray-300 p-2 text-center text-xs text-gray-500"
        onDragOver={allowDrop}
        onDrop={handleDropToRoot}
        title="여기에 놓으면 루트로 이동"
      >
        루트로 이동
      </div>
      <ul className="space-y-1">
        {nodes.map((n) => (
          <li key={n.id}>
            <TreeNode
              node={n}
              level={0}
              selectedId={selectedId}
              onSelect={onSelect}
              collapsed={collapsed}
              onToggle={onToggle}
              onReparent={onReparent}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreeNode(props: {
  node: AccountV2TreeNode;
  level: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  collapsed: Record<number, boolean>;
  onToggle: (id: number) => void;
  onReparent?: (draggedId: number, newParentId: number | null) => void;
}) {
  const { node, level, selectedId, onSelect, collapsed, onToggle, onReparent } = props;
  const hasChildren = (node.children || []).length > 0;
  const isCollapsed = !!collapsed[node.id];

  const onDragStart: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.dataTransfer.setData("text/account-id", String(node.id));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (e.dataTransfer.types.includes("text/account-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const draggedIdStr = e.dataTransfer.getData("text/account-id");
    const draggedId = Number(draggedIdStr);
    if (!Number.isFinite(draggedId)) return;
    if (draggedId === node.id) return;
    onReparent?.(draggedId, node.id);
  };

  return (
    <div>
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={
          "group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-gray-100 " +
          (selectedId === node.id ? "bg-gray-100 ring-1 ring-gray-300" : "")
        }
      >
        <button
          onClick={() => onToggle(node.id)}
          className="h-5 w-5 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
          title={isCollapsed ? "Expand" : "Collapse"}
          disabled={!hasChildren}
        >
          {hasChildren ? (isCollapsed ? "+" : "-") : ""}
        </button>
        <button onClick={() => onSelect(node.id)} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${badgeColor(node.type)}`}>{node.type}</span>
            <span className="font-medium text-gray-900">{node.name}</span>
            <span className="text-xs text-gray-500">{node.provider || ""}</span>
          </div>
        </button>
        <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: String((node.extra_metadata || {}).color || "transparent") }} />
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="ml-6 border-l border-gray-200 pl-3">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              collapsed={collapsed}
              onToggle={onToggle}
              onReparent={onReparent}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
