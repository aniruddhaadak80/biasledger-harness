/**
 * The loading state, and it is a third design rather than a repeat of the other two.
 *
 * It draws the *shape* of the board — five ruled columns with ruled placeholder cards — so the
 * layout does not jump when the data lands. A centred spinner would be honest and useless.
 */
export default function Loading() {
  const columns = [2, 2, 1, 1, 1]
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the claim board</span>

      <section className="ledger-head">
        <div className="ledger-title">
          <p className="eyebrow">claim board</p>
          <h1>Reading the committed audit corpus</h1>
        </div>
        <div className="ledger-figures">
          {['claims', 'attestable', 'partial', 'gaps'].map((label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="skeleton" style={{ height: '1.8rem' }} />
            </div>
          ))}
        </div>
      </section>

      <section className="board" aria-hidden="true">
        {columns.map((count, column) => (
          <div className="column" key={column}>
            <div className="column-head">
              <h2 className="skeleton" style={{ width: '7rem' }} />
              <span className="count skeleton" style={{ width: '1.2rem' }} />
            </div>
            {Array.from({ length: count }, (_, card) => (
              <div className="claim" key={card}>
                <div className="skeleton" style={{ width: '60%' }} />
                <div className="skeleton" style={{ width: '90%' }} />
                <div className="skeleton-block" style={{ height: '1.6rem' }} />
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}
