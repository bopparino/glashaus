import {
  ArrowRight,
  ArrowUp,
  ArrowLeft,
  ChatCircle,
  Notebook,
  Leaf,
  GearSix,
  X,
  Plus,
  Desktop,
  CaretRight,
  DownloadSimple,
  MagnifyingGlass,
  Stop,
} from "@phosphor-icons/react";
const icons = {
  chat: ChatCircle,
  memory: Notebook,
  leaf: Leaf,
  settings: GearSix,
  arrow: ArrowRight,
  up: ArrowUp,
  back: ArrowLeft,
  close: X,
  plus: Plus,
  monitor: Desktop,
  chevron: CaretRight,
  download: DownloadSimple,
  search: MagnifyingGlass,
  stop: Stop,
};
export type IconName = keyof typeof icons;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} weight="thin" aria-hidden="true" />;
}
