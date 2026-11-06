import { SvgIcon } from "@/components/provider-icons";
import { MODEL_ICON_SVGS, type ModelIconId } from "@/model-icons/icons";

export function ModelIconGlyph({
  id,
  size,
  color,
}: {
  id: ModelIconId;
  size: number;
  color: string;
}) {
  return <SvgIcon svg={MODEL_ICON_SVGS[id]} size={size} color={color} />;
}
