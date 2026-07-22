import { useLocation } from "wouter";
import type { Panel } from "../../../lib/screen";
import { Tile, type TileSize, type TileShape } from "../../tile/Tile";

/**
 * Tile panel — the runtime of the base `tile` atom on a screen. Renders its content with the tile's
 * size / colour / shape; STATIC by default, and a clickable button (navigating to `action`) when the
 * def sets `clickable`. config: { content, size?, color?, shape?, clickable?, action? }.
 */
const SIZES: TileSize[] = ["small", "medium", "large"];
const SHAPES: TileShape[] = ["square", "rounded", "pill", "circle"];

export function TilePanel({ panel }: { panel: Panel }) {
  const [, navigate] = useLocation();
  const c = panel.config ?? {};
  const size = SIZES.includes(c["size"] as TileSize) ? (c["size"] as TileSize) : undefined;
  const shape = SHAPES.includes(c["shape"] as TileShape) ? (c["shape"] as TileShape) : undefined;
  const color = typeof c["color"] === "string" ? (c["color"] as string) : undefined;
  const clickable = c["clickable"] === true;
  const action = typeof c["action"] === "string" ? (c["action"] as string) : undefined;

  return (
    <Tile
      content={String(c["content"] ?? panel.title ?? "")}
      {...(size ? { size } : {})}
      {...(color ? { color } : {})}
      {...(shape ? { shape } : {})}
      clickable={clickable}
      {...(clickable && action ? { onClick: () => navigate(action) } : {})}
    />
  );
}
