import AppRouter from "./app/router/AppRouter";

/*
 * Create React App's default App entry now delegates to the real router in
 * src/app/router/AppRouter.jsx.
 */
function App() {
  return <AppRouter />;
}

export default App;
