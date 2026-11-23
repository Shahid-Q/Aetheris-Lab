import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { categories, searchChemicals } from "../data/chemicals";
import { Icon } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
export default function Library() {
  const t = useText();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (value: string) =>
    setParams(value ? { q: value } : {}, { replace: true });
  const [category, setCategory] = useState("All entries");
  const [visible, setVisible] = useState(8);
  const filtered = searchChemicals(query, category);
  return (
    <div className="page">
      <PageHeading
        eyebrow={t("localReference")}
        title={t("library")}
        description={t("libraryIntro")}
      />
      <TextField
        className="library-search"
        fullWidth
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setVisible(8);
        }}
        slotProps={{
          htmlInput: { "aria-label": t("search") },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Icon name="search" />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t("close")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
      {query && (
        <div className="suggestions">
          {filtered.slice(0, 4).map((c) => (
            <Chip
              key={c.id}
              label={c.name + " · " + c.cas}
              onClick={() => setQuery(c.name)}
              variant="outlined"
            />
          ))}
        </div>
      )}
      <div className="filter-row" aria-label={t("classification")}>
        {categories.map((c) => (
          <Chip
            key={c}
            component="button"
            type="button"
            label={c === "All entries" ? t("all") : c}
            variant={category === c ? "filled" : "outlined"}
            aria-pressed={category === c}
            onClick={() => {
              setCategory(c);
              setVisible(8);
            }}
            className={category === c ? "selected-filter" : ""}
          />
        ))}
      </div>
      <p className="catalog-note">
        <Icon name="info" />
        {t("catalogNote")}
      </p>
      {filtered.length ? (
        <Paper className="catalog-list">
          <div className="catalog-table-heading">
            <span>{t("substance")}</span>
            <span>{t("cas")}</span>
            <span>{t("classification")}</span>
          </div>
          {filtered.slice(0, visible).map((c) => (
            <Link className="catalog-row" to={"/library/" + c.id} key={c.id}>
              <div className="catalog-substance">
                <span className="catalog-formula">{c.formula}</span>
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.aliases[0]}</small>
                </span>
              </div>
              <span className="catalog-cas" dir="ltr">
                {c.cas}
              </span>
              <span className="catalog-category">{c.category}</span>
              <Icon name="chevron_right" />
            </Link>
          ))}
        </Paper>
      ) : (
        <div className="panel empty-state">
          <Icon name="search_off" />
          <h2>{t("empty")}</h2>
          <p>{t("emptyText")}</p>
        </div>
      )}
      {visible < filtered.length && (
        <Button onClick={() => setVisible((v) => v + 8)}>
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
