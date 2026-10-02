#!/usr/bin/env python3
"""Check the checked-in Claude plugin and its scenario/eval inputs."""

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins/radius"


def load_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def main():
    marketplace = load_json(ROOT / ".claude-plugin/marketplace.json")
    manifest = load_json(PLUGIN / ".claude-plugin/plugin.json")
    entries = marketplace["plugins"]
    assert len(entries) == 1
    assert entries[0]["source"] == "./plugins/radius"
    assert entries[0]["name"] == manifest["name"]

    skills = sorted((PLUGIN / "skills").glob("*/SKILL.md"))
    assert skills, "no skills found"
    fixtures = 0
    for skill in skills:
        content = skill.read_text(encoding="utf-8")
        assert content.startswith("---\n"), f"missing frontmatter: {skill}"
        frontmatter = content.split("---", 2)[1]
        assert f"name: {skill.parent.name}" in frontmatter, f"name mismatch: {skill}"
        assert "description:" in frontmatter, f"missing description: {skill}"
        for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", content):
            if "://" not in target and not target.startswith("#"):
                assert (skill.parent / target).exists(), f"broken link {target} in {skill}"
        for path in (skill.parent / "evaluations").glob("*.json"):
            scenario = load_json(path)
            assert scenario.get("query") and (
                scenario.get("success_criteria") or scenario.get("expected_behavior")
            ), path
            assert skill.parent.name in scenario.get("skills", []), path
            fixtures += 1

    cases = sorted((PLUGIN / "evals").glob("*/prompt.md"))
    assert cases, "no Claude plugin eval cases found"
    for prompt in cases:
        assert prompt.read_text(encoding="utf-8").startswith("---\n"), prompt
        assert list((prompt.parent / "graders").glob("*.md")), prompt

    print(f"Validated {len(skills)} skills, {fixtures} scenario fixtures, {len(cases)} Claude eval cases")


if __name__ == "__main__":
    main()
