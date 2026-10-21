"""Slice 5 — inventory of Rewards capabilities that are implemented vs launch-gated / missing.

These assertions document product readiness. They must fail if launch defaults silently enable
incomplete PAYG or cash-referral programs.
"""
from package_program import launch_package_program
from rewards import launch_rewards


def test_payg_enrolment_is_not_enabled_at_launch():
    program = launch_package_program()
    assert program["paygEnrolmentEnabled"] is False


def test_cash_referral_program_is_not_enabled_at_launch():
    program = launch_package_program()
    assert program["referralCashEnabled"] is False


def test_prepaid_package_sales_paused_until_owner_enables():
    program = launch_package_program()
    assert program["salesEnabled"] is False
    assert program["packageTiers"]
    assert 60 in program["eligibleDurations"]


def test_points_rewards_remain_launch_gated_off():
    cfg = launch_rewards()
    assert cfg["enabled"] is False
    assert cfg["earningEnabled"] is False
    assert cfg["redemptionEnabled"] is False
    assert cfg["referralsEnabled"] is False
    assert cfg["taxTreatment"] == "unconfirmed"
