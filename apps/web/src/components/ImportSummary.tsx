import type { ImportResultDto } from '@calendar/shared';

/** Resultado de importar o sincronizar un `.ics`: recuento, avisos y eventos omitidos. */
export function ImportSummary({ result }: { result: ImportResultDto }) {
  const counts = [
    `${result.created} nuevos`,
    `${result.updated} actualizados`,
    `${result.unchanged} sin cambios`,
  ];
  if (result.removed > 0) counts.push(`${result.removed} eliminados`);

  return (
    <div className="summary" role="status">
      <p>{counts.join(' · ')}</p>
      {result.warnings.length > 0 && (
        <details>
          <summary>
            {result.warnings.length} {result.warnings.length === 1 ? 'aviso' : 'avisos'}
          </summary>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {result.skipped.length > 0 && (
        <details>
          <summary>
            {result.skipped.length} {result.skipped.length === 1 ? 'omitido' : 'omitidos'}
          </summary>
          <ul>
            {result.skipped.map((item, i) => (
              <li key={`${item.title}-${i}`}>
                <strong>{item.title}</strong>: {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
