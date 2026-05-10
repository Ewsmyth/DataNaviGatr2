import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

/*
 * Smoke test for the landing menu. MemoryRouter provides routing context without
 * starting a real browser history, and the assertions make sure the expected
 * menu destinations render.
 */
test('renders landing navigation', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByRole('heading', { name: /DataNaviGatr2/i })).toBeInTheDocument();
  expect(screen.getByText(/Ingest/i)).toBeInTheDocument();
  expect(screen.getByText(/DataView/i)).toBeInTheDocument();
  expect(screen.getByText(/Portainer/i)).toBeInTheDocument();
  expect(screen.queryByText(/Mongo Express/i)).not.toBeInTheDocument();
});
