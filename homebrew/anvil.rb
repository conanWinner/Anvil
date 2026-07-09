# Homebrew formula for Anvil CLI
# To install: brew install coleam00/anvil/anvil
#
# This formula downloads pre-built binaries from GitHub releases.
# For development, see: https://github.com/conanWinner/Anvil

class Anvil < Formula
  desc "Remote agentic coding platform - control AI assistants from anywhere"
  homepage "https://github.com/conanWinner/Anvil"
  version "0.5.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/conanWinner/Anvil/releases/download/v#{version}/anvil-darwin-arm64"
      sha256 "3258a78413f6cc0eb8fb214b3293bccbbdb670c09c973821633ee478c6d91bd1"
    end
    on_intel do
      url "https://github.com/conanWinner/Anvil/releases/download/v#{version}/anvil-darwin-x64"
      sha256 "82d46f2f9f520585c7e030cb48f6d7f174c534810a94227ad8ce83bb3255ee59"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/conanWinner/Anvil/releases/download/v#{version}/anvil-linux-arm64"
      sha256 "74c86788121e386fe7c309dc5178417ea555795fc92804d7ebdc1f16e98d6080"
    end
    on_intel do
      url "https://github.com/conanWinner/Anvil/releases/download/v#{version}/anvil-linux-x64"
      sha256 "dff16b810a0736c651cadffb4f0cef8eca491f3c2137d64aa2324c07333fb455"
    end
  end

  def install
    binary_name = case
    when OS.mac? && Hardware::CPU.arm?
      "anvil-darwin-arm64"
    when OS.mac? && Hardware::CPU.intel?
      "anvil-darwin-x64"
    when OS.linux? && Hardware::CPU.arm?
      "anvil-linux-arm64"
    when OS.linux? && Hardware::CPU.intel?
      "anvil-linux-x64"
    end

    bin.install binary_name => "anvil"
  end

  test do
    # Basic version check - anvil version should exit with 0 on success
    assert_match version.to_s, shell_output("#{bin}/anvil version")
  end
end
