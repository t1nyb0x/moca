/**
 * アプリケーションの外枠。
 *
 * 3D ビューとチャット UI を左右に並べる。3D ビューは React の管理外に
 * 置くため、ここでは器だけを用意する (ADR-0007)。
 */
export function App(): React.JSX.Element {
  return (
    <div className="app">
      <main className="app__chat">
        <p className="app__placeholder">
          チャット UI は段 6 で実装する。
        </p>
      </main>
    </div>
  );
}
