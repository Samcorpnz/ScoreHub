import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LogoUploadCard, ScoreButtons } from "../primitives";

afterEach(cleanup);

function makeFile(name = "logo.png") {
  return new File(["fake"], name, { type: "image/png" });
}

describe("LogoUploadCard", () => {
  it("renders the empty drop-zone prompt and Upload Logo label when logoSrc is null", () => {
    render(
      <LogoUploadCard
        testId="t"
        logoSrc={null}
        alt="Team logo"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Click or drag to upload")).toBeInTheDocument();
    expect(screen.getByTestId("t-upload-button")).toHaveTextContent("Upload Logo");
    expect(screen.queryByTestId("t-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("t-remove-button")).not.toBeInTheDocument();
  });

  it("renders the image preview and Replace Logo label when logoSrc is set", () => {
    render(
      <LogoUploadCard
        testId="t"
        logoSrc="https://example.com/logo.png"
        alt="Team logo"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByTestId("t-preview")).toBeInTheDocument();
    expect(screen.getByTestId("t-upload-button")).toHaveTextContent("Replace Logo");
    expect(screen.getByTestId("t-remove-button")).toBeInTheDocument();
  });

  it("calls onUpload with the selected file when a file is chosen via the input", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(
      <LogoUploadCard testId="t" logoSrc={null} alt="Team logo" onUpload={onUpload} onRemove={vi.fn()} />
    );
    const file = makeFile();
    const input = screen.getByTestId("t-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
  });

  it("calls onUpload with the dropped file", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(
      <LogoUploadCard testId="t" logoSrc={null} alt="Team logo" onUpload={onUpload} onRemove={vi.fn()} />
    );
    const file = makeFile("dropped.png");
    const dropZone = screen.getByTestId("t-input").previousSibling as HTMLElement;
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
  });

  it("shows an error message when onUpload rejects", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("upload failed"));
    render(
      <LogoUploadCard testId="t" logoSrc={null} alt="Team logo" onUpload={onUpload} onRemove={vi.fn()} />
    );
    const input = screen.getByTestId("t-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByTestId("t-error")).toHaveTextContent("upload failed"));
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <LogoUploadCard
        testId="t"
        logoSrc="https://example.com/logo.png"
        alt="Team logo"
        onUpload={vi.fn()}
        onRemove={onRemove}
      />
    );
    fireEvent.click(screen.getByTestId("t-remove-button"));
    await waitFor(() => expect(onRemove).toHaveBeenCalled());
  });

  it("disables the upload button while uploading is in flight", async () => {
    let resolveUpload: () => void = () => {};
    const onUpload = vi.fn(
      () => new Promise<void>(resolve => { resolveUpload = resolve; })
    );
    render(
      <LogoUploadCard testId="t" logoSrc={null} alt="Team logo" onUpload={onUpload} onRemove={vi.fn()} />
    );
    const input = screen.getByTestId("t-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByTestId("t-upload-button")).toBeDisabled());
    resolveUpload();
    await waitFor(() => expect(screen.getByTestId("t-upload-button")).not.toBeDisabled());
  });
});

describe("ScoreButtons", () => {
  // The grid's children are the −buttons, the score and the +buttons, then one
  // label cell per column in the same order — so a cell's label is exactly one
  // row below it, in the same column.
  it("puts each label in the same grid column as its + button", () => {
    const { container } = render(
      <ScoreButtons score={12} onAdjust={vi.fn()} scoreIncrements={[3, 5, 7]} scoreLabels={["PEN/DG", "TRY", "CONV TRY"]} testIdPrefix="t" />
    );
    const cells = Array.from(container.firstElementChild!.children);
    const row = 3 * 2 + 1;
    expect(cells).toHaveLength(row * 2);
    const labelUnder = (testId: string) => cells[cells.indexOf(screen.getByTestId(testId)) + row].textContent;
    // A zero-width space after the slash lets it wrap there, not mid-word
    expect(labelUnder("t-inc-3")).toBe("PEN/\u200bDG");
    expect(labelUnder("t-inc-5")).toBe("TRY");
    expect(labelUnder("t-inc-7")).toBe("CONV TRY");
    // −buttons mirror the + ones and stay unlabelled
    expect(labelUnder("t-dec-3")).toBe("");
  });

  it("renders no label row for a sport without labels", () => {
    const { container } = render(<ScoreButtons score={0} onAdjust={vi.fn()} scoreIncrements={[1]} />);
    expect(container.firstElementChild!.children).toHaveLength(3);
  });

  it("adjusts by the button's value", () => {
    const onAdjust = vi.fn();
    render(<ScoreButtons score={0} onAdjust={onAdjust} scoreIncrements={[1, 2]} testIdPrefix="t" />);
    fireEvent.click(screen.getByTestId("t-inc-2"));
    fireEvent.click(screen.getByTestId("t-dec-1"));
    expect(onAdjust.mock.calls).toEqual([[2], [-1]]);
  });
});
