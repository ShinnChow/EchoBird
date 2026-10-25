#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Sample {
    pub point: (f64, f64),
    pub down: bool,
    pub window: Option<u64>,
    pub keys: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Event {
    None,
    Cancel,
    Select { window: u64, point: (f64, f64) },
}

#[derive(Default)]
pub(super) struct Tracker {
    pub window: Option<u64>,
    down: bool,
    press: Option<Sample>,
    last_release: Option<(u64, Sample)>,
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

impl Tracker {
    pub fn update(&mut self, sample: Sample, now: u64, inside: bool) -> Event {
        let changed = self.window != sample.window;
        self.window = sample.window;
        if changed || sample.keys {
            self.press = None;
            self.last_release = None;
        }
        let mut event = if changed || sample.keys {
            Event::Cancel
        } else {
            Event::None
        };
        if sample.down && !self.down {
            self.press = (!inside && !sample.keys).then_some(sample);
            if !inside {
                event = Event::Cancel;
            }
        } else if !sample.down && self.down {
            if let Some(press) = self
                .press
                .take()
                .filter(|press| press.window == sample.window)
            {
                let double = self.last_release.is_some_and(|(when, last)| {
                    now.saturating_sub(when) <= 450
                        && last.window == sample.window
                        && distance(last.point, sample.point) <= 5.0
                });
                if distance(press.point, sample.point) >= 6.0 || double {
                    if let Some(window) = sample.window {
                        event = Event::Select {
                            window,
                            point: sample.point,
                        };
                    }
                }
                self.last_release = Some((now, sample));
            }
        }
        self.down = sample.down;
        event
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(window: u64, x: f64, down: bool) -> Sample {
        Sample {
            point: (x, 100.0),
            down,
            window: Some(window),
            keys: false,
        }
    }

    #[test]
    fn drag_selects_but_cancel_click_and_window_switch_do_not_reuse_it() {
        let mut tracker = Tracker::default();
        assert_eq!(
            tracker.update(sample(1, 10.0, true), 0, false),
            Event::Cancel
        );
        assert_eq!(
            tracker.update(sample(1, 80.0, false), 150, false),
            Event::Select {
                window: 1,
                point: (80.0, 100.0)
            }
        );
        assert_eq!(
            tracker.update(sample(1, 200.0, true), 200, false),
            Event::Cancel
        );
        assert_eq!(
            tracker.update(sample(1, 200.0, false), 250, false),
            Event::None
        );
        assert_eq!(
            tracker.update(sample(2, 200.0, false), 300, false),
            Event::Cancel
        );
        assert_eq!(
            tracker.update(sample(2, 200.0, false), 350, false),
            Event::None
        );
    }

    #[test]
    fn double_click_selects_and_toolbar_click_does_not_cancel_or_reselect() {
        let mut tracker = Tracker::default();
        tracker.update(sample(1, 20.0, true), 0, false);
        tracker.update(sample(1, 20.0, false), 80, false);
        tracker.update(sample(1, 20.0, true), 150, false);
        assert!(matches!(
            tracker.update(sample(1, 20.0, false), 200, false),
            Event::Select { .. }
        ));
        assert_eq!(
            tracker.update(sample(1, 40.0, true), 250, true),
            Event::None
        );
        assert_eq!(
            tracker.update(sample(1, 40.0, false), 300, true),
            Event::None
        );
        let mut key = sample(1, 40.0, false);
        key.keys = true;
        assert_eq!(tracker.update(key, 350, false), Event::Cancel);
    }
}
