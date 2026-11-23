import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { sessionQueryKey, AdminError } from "./api";
import "../../src/styles.css";
import "./admin.css";

const client = new QueryClient({
  queryCache: new QueryCache({
    onError(error, query) {
      if (error instanceof AdminError && [401, 403].includes(error.status) && query.queryKey[0] === "admin") {
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      }
    },
  }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
