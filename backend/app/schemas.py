from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


class Command(BaseModel):
    cmd: str                       # inject | overhaul | rate | noise | manual | auto | speed | scenario | pause | resume
    mode: Optional[str] = None
    value: Optional[float] = None
    scenario: Optional[str] = None
    throttle: Optional[float] = None
    alt_m: Optional[float] = None
    isa_dev_c: Optional[float] = None
    tas_ms: Optional[float] = None
    speed: Optional[float] = None
    auto: Optional[bool] = None


class MissionSimRequest(BaseModel):
    tail: Optional[str] = None
    scenario: str = "standard"
    altitude_m: float = Field(4000, ge=0, le=13000)
    isa_dev_c: float = Field(10, ge=-40, le=50)
    duration_h: float = Field(10, gt=0, le=40)
    throttle_profile: str = "steady"   # steady | loiter | transients


class LoginRequest(BaseModel):
    login_id: str
    password: str
    portal: Optional[str] = None       # "operator" | "admin" -> the account's role must match the portal used


class RegisterRequest(BaseModel):
    login_id: str = Field(max_length=48)
    full_name: str = Field(max_length=120)
    password: str = Field(max_length=128)
    designation: str = Field("", max_length=80)
    squadron: str = Field("", max_length=64)
    email: str = Field("", max_length=160)
    phone: str = Field("", max_length=32)


class AdminRegisterRequest(RegisterRequest):
    registration_key: str = Field(max_length=200)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class FleetActionRequest(BaseModel):
    action: str                        # ground | clear | recall | schedule_maintenance
    note: Optional[str] = None


class OperatorCreate(BaseModel):
    login_id: str
    full_name: str
    designation: str = ""
    squadron: str = "1 UAV Squadron"
    email: str = ""
    phone: str = ""
    role: str = "operator"             # operator | admin
    password: Optional[str] = None     # omitted => a temporary password is generated
    drones: List[str] = []             # tail numbers this operator may access


class OperatorUpdate(BaseModel):
    full_name: Optional[str] = None
    designation: Optional[str] = None
    squadron: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    drones: Optional[List[str]] = None


class DroneCreate(BaseModel):
    tail_number: str
    name: str = ""
    asset_code: str = "AE-115T"
    squadron: str = "1 UAV Squadron"
    data_source: str = "simulated"     # simulated | live_can
    engine_hours: float = 0.0
    notes: str = ""
    operators: List[str] = []          # operator login IDs to assign


class DroneUpdate(BaseModel):
    name: Optional[str] = None
    asset_code: Optional[str] = None
    squadron: Optional[str] = None
    data_source: Optional[str] = None
    engine_hours: Optional[float] = None
    notes: Optional[str] = None
    active: Optional[bool] = None
    operators: Optional[List[str]] = None


class NotifIds(BaseModel):
    ids: Optional[List[int]] = None    # None + all=True => everything matching the filter
    all: bool = False
    category: Optional[str] = None
    severity: Optional[str] = None
    tail: Optional[str] = None


class WorkOrderUpdate(BaseModel):
    status: str                        # open | in_progress | closed