import { describe, it, expect } from 'vitest';
import { isConsecutiveDuplicate, isHallucination } from '../config/hallucinations';

describe('Hallucination Filters', () => {
  it('should detect typical Whisper silence hallucinations in Spanish', () => {
    expect(isHallucination('Gracias por ver el video.')).toBe(true);
    expect(isHallucination('Subtítulos por la comunidad de Amara.org')).toBe(true);
    expect(isHallucination('Suscríbete a mi canal!')).toBe(true);
    expect(isHallucination('Muchas gracias por ver')).toBe(true);
    expect(isHallucination('www.ejemplo.com')).toBe(true);
    expect(isHallucination('   ')).toBe(true);
  });

  it('should detect character repetition and looping hallucinations', () => {
    expect(isHallucination('aaaaaaaaaaaa')).toBe(true);
    expect(isHallucination('y entonces y entonces y entonces y entonces')).toBe(true);
    // User's exact case caused by distant audio / low SNR
    expect(
      isHallucination(
        '¡Vamos a ver la tienda de la tienda! ¡Vamos a ver la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda de la tienda'
      )
    ).toBe(true);
  });

  it('should not flag valid dental dialogue', () => {
    expect(isHallucination('Vamos a realizar una conductometría en la pieza 1.6.')).toBe(false);
    expect(isHallucination('Sentís alguna molestia al presionar acá?')).toBe(false);
    expect(isHallucination('Aplicamos anestesia troncular en la zona inferior derecha.')).toBe(false);
  });

  it('should identify consecutive duplicate segments', () => {
    const prev = 'Revisamos la pieza dieciséis.';
    expect(isConsecutiveDuplicate('Revisamos la pieza dieciséis.', prev)).toBe(true);
    expect(isConsecutiveDuplicate('Revisamos la pieza dieciséis!', prev)).toBe(true);
    expect(isConsecutiveDuplicate('Ahora procedemos a la obturación.', prev)).toBe(false);
  });
});
