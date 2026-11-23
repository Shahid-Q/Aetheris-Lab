import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import { listLocalRequests } from "../services/local";
import { getServiceStatus } from "../services/publicRequests";
import { useReceipts } from "../services/useReceipts";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
import RequestList from "../components/RequestList";
export default function Home() {
  const t = useText();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const recent = useQuery({
    queryKey: ["requests"],
    queryFn: listLocalRequests,
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: ({ signal }) => getServiceStatus(signal),
    retry: false,
    staleTime: 60_000,
  });
  const agent = services.data?.agent;
  const { receipts } = useReceipts();
  return (
    <div className="page home-page">
      <div className="workspace-heading">
        <h1>{t("homeTitle")}</h1>
        <p>{t("homeDescription")}</p>
      </div>
      <Paper component="section" className="start-work">
        <div className="start-work-copy">
          <span className="work-icon">
            <Icon name="science" />
          </span>
          <h2>{t("startRequest")}</h2>
          <p>{t("startRequestDescription")}</p>
          <div className="button-row">
            <Button
              component={Link}
              to="/analysis"
              variant="contained"
              startIcon={<Icon name="add" />}
            >
              {t("newAnalysis")}
            </Button>
            <Button
              component={Link}
              to="/analysis?method=camera"
              startIcon={<Icon name="photo_camera" />}
            >
              {t("scanLabel")}
            </Button>
          </div>
        </div>
        <div className="request-outline" aria-hidden="true">
          <div>
            <span className="outline-letter">A</span>
            <span className="outline-line" />
            <Icon name="science" />
          </div>
          <div>
            <span className="outline-letter">B</span>
            <span className="outline-line" />
            <Icon name="science" />
          </div>
          <span className="outline-caption">
            <Icon name="verified_user" />
            {t("expert")}
          </span>
        </div>
      </Paper>
      <section className="home-library">
        <div>
          <h2>{t("library")}</h2>
          <p>{t("librarySearchHint")}</p>
        </div>
        <form
          className="home-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/library?q=" + encodeURIComponent(search.trim()));
          }}
        >
          <Icon name="search" />
          <input
            aria-label={t("search")}
            placeholder={t("shortSearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" aria-label={t("search")}>
            {t("searchAction")}
          </Button>
        </form>
      </section>
      <section className="home-recent">
        <div className="section-heading">
          <h2>{t("recent")}</h2>
          <Button component={Link} to="/requests">
            {t("viewAll")}
          </Button>
        </div>
        {(receipts.length > 0 || recent.data?.length) ? (
          <RequestList requests={recent.data ?? []} receipts={receipts} limit={3} />
        ) : recent.isPending ? (
          <div className="skeleton" />
        ) : recent.isError ? (
          <Notice kind="error">{t("draftsUnavailable")}</Notice>
        ) : (
          <div className="recent-empty">
            <Icon name="assignment" />
            <div>
              <h3>{t("noLocalRequests")}</h3>
              <p>{t("noRequestsText")}</p>
            </div>
          </div>
        )}
      </section>
      <section className="workspace-status">
        <div className="status-heading">
          <Icon name="info" />
          <h2>{t("services")}</h2>
        </div>
        <div className="status-items">
          <span>
            {t("catalog")}
            <strong>{t("available")}</strong>
          </span>
          <span>
            {t("ai")}
            <strong>{t(services.isPending ? "loading" : services.isError ? "statusUnavailable"
                : agent === "configured" ? "agentConfigured"
                : agent === "unconfigured" ? "agentUnconfiguredStatus"
                : agent === "disabled" ? "agentDisabled" : "offline")}</strong>
          </span>
        </div>
      </section>
    </div>
  );
}
