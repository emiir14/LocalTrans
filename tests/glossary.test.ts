import { describe, it, expect } from 'vitest';
import { applyGlossary, DEFAULT_DENTAL_GLOSSARY } from '../config/glossary';

describe('Dental Glossary Post-Processing', () => {
  it('should replace misheard dental terminology with correct forms', () => {
    const input = 'El paciente requiere conducto metría en molar y una canilla de porcelana.';
    const output = applyGlossary(input, DEFAULT_DENTAL_GLOSSARY);

    expect(output).toContain('conductometría');
    expect(output).toContain('carilla de porcelana');
  });

  it('should preserve capitalization when original word begins with uppercase', () => {
    const input = 'Conducto metría en la pieza 2.4.';
    const output = applyGlossary(input, DEFAULT_DENTAL_GLOSSARY);

    expect(output).toBe('Conductometría en la pieza 2.4.');
  });

  it('should not alter text without matching glossary items', () => {
    const input = 'Paciente sin antecedentes patológicos relevantes.';
    const output = applyGlossary(input, DEFAULT_DENTAL_GLOSSARY);

    expect(output).toBe(input);
  });
});
