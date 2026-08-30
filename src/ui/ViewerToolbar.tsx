import type { RefObject } from "react";

import { useAppStore } from "@/app/store";
import { MAX_SCALE, MIN_SCALE } from "@/domain/mascot/window";
import type { Viewer, FramingPreset } from "@/render/Viewer";

const FRAMINGS: { preset: FramingPreset; label: string }[] = [
  { preset: "face", label: "顔" },
  { preset: "upper", label: "上半身" },
  { preset: "full", label: "全身" },
];

const DEFAULT_COLOR = "#26262c";

/**
 * 3D ビューの操作 (要件 F-03)。
 *
 * `Viewer` は React の管理外にあるので、参照を受け取って命令的に呼ぶ
 * (ADR-0007)。表示する状態はストアから取る。
 */
export function ViewerToolbar({
  viewer,
}: {
  viewer: RefObject<Viewer | null>;
}): React.JSX.Element {
  const characters = useAppStore((state) => state.characters);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const backgroundColor = useAppStore((state) => state.settings?.backgroundColor ?? null);
  const saveCameraState = useAppStore((state) => state.saveCameraState);
  const setBackgroundColor = useAppStore((state) => state.setBackgroundColor);
  const mascotScale = useAppStore((state) => state.settings?.mascotScale ?? 0.5);
  const setMascotScale = useAppStore((state) => state.setMascotScale);

  const character = characters.find((item) => item.id === activeCharacterId);
  const saved = character?.cameraPreset ?? null;

  return (
    <div className="vtool">
      <div className="vtool__row">
        {FRAMINGS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              const instance = viewer.current;
              if (instance === null) return;
              instance.setFraming(preset);
              // 構図の切り替えは OrbitControls を経由しないので、操作の
              // 終わりが飛んでこない。ここで明示的に覚えさせる (F-03-5)。
              void saveCameraState(instance.cameraState());
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        カメラ位置は操作のたびに自動で覚えるため (要件 F-03-5)、覚えさせる
        ボタンと覚えた位置へ戻すボタンは意味を持たない。残るのは、覚えた
        ものを捨てて既定の構図へ戻す操作だけ。
      */}
      <div className="vtool__row">
        <button
          type="button"
          disabled={saved === null}
          title={
            saved === null
              ? "覚えた位置がありません"
              : "覚えた位置を捨てて既定の構図へ戻します"
          }
          onClick={() => {
            void saveCameraState(null);
            viewer.current?.setFraming("upper");
          }}
        >
          位置を忘れる
        </button>
      </div>

      {/* 机の上に置いたときの大きさ (要件 F-13-3)。マスコット表示中は
          ホイールでも変えられる。 */}
      <div className="vtool__row">
        <label className="vtool__scale" title="机の上に置いたときの大きさです">
          倍率
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.05}
            value={mascotScale}
            onChange={(event) => void setMascotScale(Number(event.target.value))}
          />
          <span>{Math.round(mascotScale * 100)}%</span>
        </label>
      </div>

      <div className="vtool__row">
        <label className="vtool__color">
          背景
          <input
            type="color"
            value={backgroundColor ?? DEFAULT_COLOR}
            onChange={(event) => void setBackgroundColor(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={backgroundColor === null}
          onClick={() => void setBackgroundColor(null)}
        >
          既定に戻す
        </button>
      </div>
    </div>
  );
}
