import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ClockPanel } from "../ClockPanel";

afterEach(cleanup);

describe("ClockPanel", () => {
  it("renders the running indicator as LIVE when running, in green-ish accent", () => {
    render(
      <ClockPanel
        clockSeconds={125}
        countDown={false}
        period="1"
        isRunning={true}
        hornActive={false}
        matchName="Round 1"
      />
    );
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("02:05")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders PAUSED when not running", () => {
    render(
      <ClockPanel
        clockSeconds={30}
        countDown={false}
        period="1"
        isRunning={false}
        hornActive={false}
      />
    );
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
  });

  it("shows period break headline for a regular break", () => {
    render(
      <ClockPanel
        clockSeconds={0}
        countDown={false}
        period="2"
        periodBreak={true}
        periodLabel="QTR"
        isRunning={false}
        hornActive={false}
      />
    );
    expect(screen.getByText("QTR BREAK")).toBeInTheDocument();
  });

  it("shows HALF TIME headline when periodLabel is HALF and on break", () => {
    render(
      <ClockPanel
        clockSeconds={0}
        countDown={false}
        period="2"
        periodBreak={true}
        periodLabel="HALF"
        isRunning={false}
        hornActive={false}
      />
    );
    expect(screen.getByText("HALF TIME")).toBeInTheDocument();
  });

  it("shows EXTRA TIME subtext when period is E and not on break", () => {
    render(
      <ClockPanel
        clockSeconds={0}
        countDown={false}
        period="E"
        periodBreak={false}
        periodLabel="QTR"
        isRunning={false}
        hornActive={false}
      />
    );
    expect(screen.getByText("EXTRA TIME")).toBeInTheDocument();
  });

  it("spells out extra time and overtime under the period number", () => {
    const { rerender } = render(
      <ClockPanel clockSeconds={420} countDown={true} period="1" periodLabel="ET" isRunning={false} hornActive={false} />
    );
    expect(screen.getByText("EXTRA TIME")).toBeInTheDocument();
    rerender(
      <ClockPanel clockSeconds={300} countDown={true} period="1" periodLabel="OT" isRunning={false} hornActive={false} />
    );
    expect(screen.getByText("OVERTIME")).toBeInTheDocument();
  });

  it("shows the break label it's given in place of the default", () => {
    render(
      <ClockPanel clockSeconds={420} countDown={true} period="1" periodBreak={true} periodLabel="ET" breakLabel="FULL TIME" isRunning={false} hornActive={false} />
    );
    expect(screen.getByTestId("display-period")).toHaveTextContent("FULL TIME");
  });

  it("flags a notice such as a power play, except during a break", () => {
    const { rerender } = render(
      <ClockPanel clockSeconds={90} countDown={true} period="2" notice="POWER PLAY" isRunning={true} hornActive={false} />
    );
    expect(screen.getByTestId("display-notice")).toHaveTextContent("POWER PLAY");
    rerender(
      <ClockPanel clockSeconds={90} countDown={true} period="2" periodBreak={true} notice="POWER PLAY" isRunning={false} hornActive={false} />
    );
    expect(screen.queryByTestId("display-notice")).not.toBeInTheDocument();
  });

  it("shows a shoot-out's tally in place of the period", () => {
    render(
      <ClockPanel clockSeconds={0} countDown={false} period="3" periodBreak={true} periodLabel="ET" breakLabel="FULL TIME"
        shootout={{ label: "PENALTIES", home: [true, true, false], visitor: [true, false], homeGoals: 2, visitorGoals: 1 }}
        isRunning={false} hornActive={false} />
    );
    const tally = screen.getByTestId("display-shootout");
    expect(tally).toHaveTextContent("PENALTIES");
    expect(tally).toHaveTextContent("2 – 1");
    expect(screen.getAllByTitle("Scored")).toHaveLength(3);
    expect(screen.getAllByTitle("Missed")).toHaveLength(2);
    expect(screen.queryByTestId("display-period")).not.toBeInTheDocument();
  });

  it("does not render the match name or running indicator in compact size", () => {
    render(
      <ClockPanel
        clockSeconds={60}
        countDown={false}
        period="1"
        isRunning={true}
        hornActive={false}
        matchName="Should not show"
        size="compact"
      />
    );
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("applies horn-active styling class when the horn is active", () => {
    const { container } = render(
      <ClockPanel
        clockSeconds={0}
        countDown={false}
        period="1"
        isRunning={false}
        hornActive={true}
      />
    );
    expect(container.querySelector(".horn-active")).toBeInTheDocument();
  });
});
