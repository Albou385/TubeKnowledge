import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WriterBootstrapButton, WriterBootstrapForm, WriterReacquireForm, WriterRenewForm } from "@/components/portability-actions";
import { createWriterBootstrapSubmissionGate } from "./writer-bootstrap-client";

describe("interface du bootstrap writer", () => {
  it("ignore deux soumissions rapides, qu’elles viennent de la souris ou du clavier", () => {
    const gate = createWriterBootstrapSubmissionGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    expect(gate.begin()).toBe(false);
  });

  it("réactive une nouvelle tentative après une erreur", () => {
    const gate = createWriterBootstrapSubmissionGate();
    expect(gate.begin()).toBe(true);
    gate.fail();
    expect(gate.begin()).toBe(true);
  });

  it("désactive le bouton, ajoute aria-busy et affiche l’état pending", () => {
    const html = renderToStaticMarkup(createElement(WriterBootstrapButton, { pending: true, succeeded: false }));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Initialisation en cours…");
  });

  it("masque le bootstrap lorsque writer est déjà actif localement", () => {
    const html = renderToStaticMarkup(createElement(WriterBootstrapForm, { writerAlreadyActive: true }));
    expect(html).toContain("Autorité writer déjà active");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("checkpoint");
  });

  it("rend renew et reacquire sans déclencher d’appel automatique", () => {
    const renew = renderToStaticMarkup(createElement(WriterRenewForm));
    const reacquire = renderToStaticMarkup(createElement(WriterReacquireForm, { suggestedBackupId: "11111111-1111-4111-8111-111111111111" }));
    expect(renew).toContain("Renouveler writer");
    expect(renew).toContain('aria-busy="false"');
    expect(reacquire).toContain("REACQUERIR");
    expect(reacquire).toContain('aria-busy="false"');
  });
});
