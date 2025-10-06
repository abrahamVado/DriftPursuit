import PlanetSandbox from './components/PlanetSandbox';
import './style.css';

const App = () => {
  return (
    <main className="app-container">
      <header>
        <h1>Planet Sandbox</h1>
        <p>Navigate a spherical world and stay within the atmosphere.</p>
      </header>
      <PlanetSandbox />
    </main>
  );
};

export default App;
