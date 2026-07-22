/**
 * Tile — the runtime of the base `tile` atom: a bounded content block with a size, a colour and a
 * shape, STATIC by default and INTERACTIVE (a real button) when `clickable`. The additive-interactivity
 * pattern, same as charts/canvas — one flag turns a static tile into a clickable one.
 */

export type TileSize = "small" | "medium" | "large";
export type TileShape = "square" | "rounded" | "pill" | "circle";

const SIZE_CLASS: Record<TileSize, string> = {
  small: "px-2 py-1 text-xs",
  medium: "px-4 py-3 text-sm",
  large: "px-6 py-5 text-base",
};
const SHAPE_CLASS: Record<TileShape, string> = {
  square: "rounded-none",
  rounded: "rounded-lg",
  pill: "rounded-full",
  circle: "rounded-full aspect-square flex items-center justify-center",
};

export function Tile({
  content,
  size = "medium",
  color,
  shape = "rounded",
  clickable = false,
  onClick,
}: {
  content: React.ReactNode;
  size?: TileSize;
  color?: string;
  shape?: TileShape;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const cls = `inline-block border border-border ${SIZE_CLASS[size]} ${SHAPE_CLASS[shape]}`;
  const style = color ? { backgroundColor: color } : undefined;

  if (clickable) {
    return (
      <button type="button" onClick={onClick} style={style} className={`${cls} text-left hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring`}>
        {content}
      </button>
    );
  }
  return (
    <div style={style} className={cls}>
      {content}
    </div>
  );
}
