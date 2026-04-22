import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders landing navigation', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByRole('heading', { name: /DataNaviGatr2/i })).toBeInTheDocument();
  expect(screen.getByText(/Ingest/i)).toBeInTheDocument();
  expect(screen.getByText(/Portainer/i)).toBeInTheDocument();
  expect(screen.getByText(/Mongo Express/i)).toBeInTheDocument();
});
