import { useId, useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminManageAction } from "../../src/review";
import { Notice } from "../../src/ui";
import { adminManage, AdminError, sessionQueryKey } from "./api";
import { useAdminText } from "./text";

export function RequestManagement({ ids, archived, csrfToken, onSaved }: {
  ids: string[];
  archived: boolean;
  csrfToken: string;
  onSaved: (action: AdminManageAction, ids: string[]) => void | Promise<void>;
}) {
  const t = useAdminText();
  const client = useQueryClient();
  const titleId = useId();
  const descriptionId = useId();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: ({ action, targets }: { action: AdminManageAction; targets: string[] }) =>
      adminManage(action, targets, csrfToken),
    async onSuccess() {
      setDeleteIds([]);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin", "queue"] }),
        client.invalidateQueries({ queryKey: ["admin", "request"], refetchType: "none" }),
      ]);
    },
    onError(error) {
      if (error instanceof AdminError && [401, 403].includes(error.status)) {
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      }
    },
  });
  const submit = (action: AdminManageAction, targets: string[]) => mutation.mutate({ action, targets }, {
    onSuccess: () => { void onSaved(action, targets); },
  });
  const close = () => {
    if (!mutation.isPending) setDeleteIds([]);
  };

  return (
    <>
      {ids.length > 0 && <div className="button-row">
        <Button variant="outlined" disabled={mutation.isPending}
          onClick={() => submit(archived ? "restore" : "archive", ids)}>
          {t(archived ? "restoreRequest" : "archiveRequest")}
        </Button>
        <Button variant="outlined" color="error" disabled={mutation.isPending} onClick={() => {
          mutation.reset();
          setDeleteIds(ids);
        }}>
          {t("deleteRequest")}
        </Button>
      </div>}
      {mutation.isSuccess && <p role="status">{t(mutation.data.changed ? "adminSaved" : "noManagementChanges")}</p>}
      {mutation.isError && deleteIds.length === 0 && <Notice kind="error">{t("adminWriteError")}</Notice>}
      <Dialog open={deleteIds.length > 0} onClose={close} aria-labelledby={titleId} aria-describedby={descriptionId}>
        <DialogTitle id={titleId}>{t("confirmDeleteRequests")}</DialogTitle>
        <DialogContent>
          <DialogContentText id={descriptionId}>
            {t("confirmDeleteDescription").replace("{count}", String(deleteIds.length))}
          </DialogContentText>
          {mutation.isError && <Notice kind="error">{t("adminWriteError")}</Notice>}
        </DialogContent>
        <DialogActions>
          <Button autoFocus disabled={mutation.isPending} onClick={close}>{t("cancel")}</Button>
          <Button variant="outlined" color="error" disabled={mutation.isPending}
            onClick={() => submit("delete", deleteIds)}>
            {t(mutation.isPending ? "loading" : "deleteRequest")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
