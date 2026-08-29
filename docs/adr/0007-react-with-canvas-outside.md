# ADR-0007: フロントエンドは React。3D キャンバスは React の管理外に置く

- 状態: 採択
- 日付: 2026-08-29

## 文脈

フロントエンドが担うのはチャット UI、設定画面、プロファイル管理画面、および 3D ビューの器である。このうち 3D ビューは毎フレーム更新される命令的な世界であり、宣言的 UI の再レンダリングモデルと本質的に相容れない。

## 決定

React + TypeScript を採用する。ただし **3D キャンバスは React の再レンダリング対象に含めない**。

```tsx
function ViewerHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewer = new Viewer(ref.current!);
    viewer.start();
    return () => viewer.dispose();
  }, []);              // 依存配列は空。React はこの DOM を二度と触らない
  return <div ref={ref} className="viewer" />;
}
```

`Viewer` は自前のフレームループを持ち、状態は購読で受け取る（ADR-0008）。React の props で毎フレームの値を流し込まない。

## 検討した代替案

**@react-three/fiber を使う。** 採用しない。three.js のシーングラフを JSX で宣言する仕組みだが、`@pixiv/three-vrm` や `MMDLoader` は命令的な API を前提としており、ローダーが構築したオブジェクトツリーを R3F の宣言的世界へ持ち込むと、両者の管理責任が曖昧になる。SpringBone や物理演算の更新タイミングも R3F のループに合わせる必要が生じる。抽象が 1 枚増えるだけで得るものがない。

**Svelte 5。** 採用しない。記述量とバンドルサイズでは有利だが、エコシステムの厚みと知見の集めやすさで React を採る。この判断はプロジェクトオーナーの選好による。

**フレームワークなし。** 採用しない。チャット UI 単体なら成立するが、設定画面・プロバイダプロファイル・キャラクタープロファイル・PMX のモーフ再割り当て UI（P1）と積み上がると、手書き DOM 操作の保守が破綻する。

## 影響

- React は UI 層 (`src/ui/`) にのみ現れる。`domain/` と `render/` は React を import しない
- 3D ビューの表示・非表示（要件 F-02-2）は `ViewerHost` のマウント・アンマウントで表現する。アンマウント時に `dispose()` が呼ばれ、フレームループが停止する（要件 F-02-3）
- 毎フレームの値を React state に置いてはならない。置くと 60fps で再レンダリングが走る
- P3 でチャット UI と 3D ビューを別ウィンドウへ分離する際、両者が状態を購読で共有している構造が有利に働く
