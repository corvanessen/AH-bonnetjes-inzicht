import marimo

__generated_with = "0.24.2"
app = marimo.App(width="medium")


@app.cell
def _(mo):
    mo.md(
        """
        # AH kassabonnen verkennen

        Draai eerst `uv run main.py` om de accounts onder `accounts/` te
        parsen naar `data/bonnen.parquet` en `data/artikelen.parquet`. Deze
        notebook leest die twee tabellen in en laat een paar eerste inzichten
        zien.
        """
    )
    return


@app.cell
def _():
    import pandas as pd

    bonnen = pd.read_parquet("data/bonnen.parquet")
    artikelen = pd.read_parquet("data/artikelen.parquet")
    return artikelen, bonnen, pd


@app.cell
def _(bonnen, mo):
    mo.vstack([mo.md("## Bonnen"), bonnen])
    return


@app.cell
def _(artikelen, mo):
    mo.vstack([mo.md("## Artikelen"), artikelen])
    return


@app.cell
def _(mo):
    mo.md("## Totaal per maand")
    return


@app.cell
def _(bonnen, pd):
    per_maand = (
        bonnen.assign(maand=pd.to_datetime(bonnen["datum"]).dt.to_period("M").astype(str))
        .groupby("maand")[["subtotaal", "bonus_korting", "totaal"]]
        .sum()
        .reset_index()
    )
    per_maand
    return (per_maand,)


@app.cell
def _(mo):
    mo.md("## Meest gekochte producten")
    return


@app.cell
def _(artikelen):
    top_producten = (
        artikelen[artikelen["type"] == "product"]
        .groupby("omschrijving")
        .agg(keer_gekocht=("bon_id", "count"), totaal_uitgegeven=("bedrag", "sum"))
        .sort_values("keer_gekocht", ascending=False)
        .reset_index()
    )
    top_producten
    return (top_producten,)


@app.cell
def _(mo):
    mo.md("## Bonus-effect")
    return


@app.cell
def _(artikelen, mo):
    bonus_stats = artikelen[artikelen["type"] == "product"]["bonus"].value_counts()
    mo.md(
        f"""
        Van de {len(artikelen[artikelen['type'] == 'product'])} artikelregels
        hadden er **{int(bonus_stats.get(True, 0))}** bonuskorting.
        """
    )
    return (bonus_stats,)


if __name__ == "__main__":
    app.run()
