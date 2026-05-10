import AppRouter from "./router/AppRouter";

/*
 * Thin app shell used by the nested src/app structure.
 * AppRouter owns all page selection, so this component simply renders it.
 */
function App() {
  return <AppRouter />;
}

export default App;
