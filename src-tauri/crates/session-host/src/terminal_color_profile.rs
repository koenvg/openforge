use serde::{Deserialize, Deserializer, Serialize};

pub const TERMINAL_COLOR_PROFILE_VERSION: u8 = 1;
const XTERM_CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalRgbColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl TerminalRgbColor {
    pub const fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalColorProfile {
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u8,
    pub background: TerminalRgbColor,
    pub foreground: TerminalRgbColor,
    pub cursor: TerminalRgbColor,
    pub ansi_colors: [TerminalRgbColor; 16],
}

impl TerminalColorProfile {
    pub fn validate(&self) -> Result<(), crate::HostError> {
        if self.version != TERMINAL_COLOR_PROFILE_VERSION {
            return Err(crate::HostError::InvalidRequest(
                "unsupported terminal color profile version",
            ));
        }
        Ok(())
    }

    pub fn xterm_palette(self) -> [TerminalRgbColor; 256] {
        let mut palette = [TerminalRgbColor::new(0, 0, 0); 256];
        palette[..16].copy_from_slice(&self.ansi_colors);
        let mut index = 16;
        for red in XTERM_CUBE_LEVELS {
            for green in XTERM_CUBE_LEVELS {
                for blue in XTERM_CUBE_LEVELS {
                    palette[index] = TerminalRgbColor::new(red, green, blue);
                    index += 1;
                }
            }
        }
        for level in 0..24 {
            let value = 8 + level * 10;
            palette[232 + level as usize] = TerminalRgbColor::new(value, value, value);
        }
        palette
    }
}

impl Default for TerminalColorProfile {
    fn default() -> Self {
        Self {
            version: TERMINAL_COLOR_PROFILE_VERSION,
            background: TerminalRgbColor::new(255, 255, 255),
            foreground: TerminalRgbColor::new(32, 32, 32),
            cursor: TerminalRgbColor::new(32, 32, 32),
            ansi_colors: [
                TerminalRgbColor::new(32, 32, 32),
                TerminalRgbColor::new(181, 43, 58),
                TerminalRgbColor::new(23, 107, 74),
                TerminalRgbColor::new(135, 81, 11),
                TerminalRgbColor::new(36, 88, 166),
                TerminalRgbColor::new(120, 63, 150),
                TerminalRgbColor::new(23, 102, 109),
                TerminalRgbColor::new(98, 98, 98),
                TerminalRgbColor::new(98, 98, 98),
                TerminalRgbColor::new(152, 34, 48),
                TerminalRgbColor::new(18, 84, 58),
                TerminalRgbColor::new(117, 67, 9),
                TerminalRgbColor::new(29, 73, 140),
                TerminalRgbColor::new(104, 52, 131),
                TerminalRgbColor::new(18, 85, 91),
                TerminalRgbColor::new(80, 80, 80),
            ],
        }
    }
}

fn deserialize_version<'de, D>(deserializer: D) -> Result<u8, D::Error>
where
    D: Deserializer<'de>,
{
    let version = u8::deserialize(deserializer)?;
    if version != TERMINAL_COLOR_PROFILE_VERSION {
        return Err(serde::de::Error::custom(
            "unsupported terminal color profile version",
        ));
    }
    Ok(version)
}
